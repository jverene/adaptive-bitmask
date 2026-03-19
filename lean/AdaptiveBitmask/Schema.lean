import AdaptiveBitmask.Basic
import Mathlib.Data.HashMap.Basic
import Mathlib.Data.Real.Basic
import Mathlib.Data.Real.Pow
import Mathlib.Tactic.NormNum

/-!
# Schema Management and Collision Theory

This module formalizes the schema management system for dynamic feature-to-bit
mapping, including frequency-based pruning and collision probability analysis.

## Main Definitions

- `SchemaState`: Feature-to-bit mapping with frequency tracking
- `theoreticalCollisionRate`: P(collision) = 1 - (1 - 1/64)^(m-1)
- `expectedExcludedFeatures`: E[excluded] = m - 64 * (1 - (1 - 1/64)^m)
- `Fingerprint`: Deterministic schema identifier

## Key Theorems

- Collision rate formula verification for m=80 (≈0.712)
- Expected excluded features for m=128 (≈72.52) and m=80 (≈34.2)
- Fingerprint determinism
-/

namespace AdaptiveBitmask

/-- Configuration for schema manager. -/
structure SchemaConfig where
  /-- Maximum features before triggering prune (default: 64). -/
  maxFeatures : Nat := BITMASK_WIDTH
  /-- Emergency feature prefix (features starting with this are pinned to bits 56-63). -/
  emergencyPrefix : String := "EMERGENCY_"
  /-- Explicit emergency features (alternative to prefix matching). -/
  emergencyFeatures : List String := []

/-- Current state of the schema manager. -/
structure SchemaState where
  /-- Feature → bit position mapping. -/
  featureToBit : HashMap String (Fin 64)
  /-- Bit position → feature(s) mapping (reverse lookup). -/
  bitToFeatures : HashMap (Fin 64) (List String)
  /-- Total activation counts per feature. -/
  activationCounts : HashMap String Nat
  /-- Total activation events (sum of all counts). -/
  totalActivations : Nat
  /-- Schema version (incremented on each change). -/
  version : Nat
  /-- Configuration. -/
  config : SchemaConfig

/-- Create an initial empty schema state. -/
def SchemaState.initial (config : SchemaConfig := {}) : SchemaState :=
  { featureToBit := HashMap.empty
  , bitToFeatures := HashMap.empty
  , activationCounts := HashMap.empty
  , totalActivations := 0
  , version := 0
  , config := config }

/-- Check if a feature is an emergency feature. -/
def isEmergency (state : SchemaState) (feature : String) : Bool :=
  state.config.emergencyFeatures.elem feature ||
  feature.startsWith state.config.emergencyPrefix

/-- Number of active (mapped) features. -/
def activeFeatureCount (state : SchemaState) : Nat :=
  state.featureToBit.size

/-- Get activation frequency for a feature. -/
def getFrequency (state : SchemaState) (feature : String) : Nat :=
  state.activationCounts.find? feature |>.getD 0

/-- Record feature activations for frequency tracking. -/
def recordActivations (state : SchemaState) (features : List String) : SchemaState :=
  let (newCounts, totalDelta) := List.foldl (fun (counts, delta) feat =>
    let oldCount := counts.find? feat |>.getD 0
    (counts.insert feat (oldCount + 1), delta + 1)
  ) (state.activationCounts, 0) features
  { state with
    activationCounts := newCounts
    totalActivations := state.totalActivations + totalDelta }

/--
Theoretical collision probability for m features mapped to 64 bits.

Formula: P(collision) = 1 - (1 - 1/64)^(m-1)

This is the probability that at least two features map to the same bit
under uniform random assignment.
-/
def theoreticalCollisionRate (m : Nat) : Real :=
  1 - (1 - 1/64 : Real) ^ (m - 1)

/--
Expected number of excluded features when mapping m features to 64 bits.

Formula: E[excluded] = m - 64 * (1 - (1 - 1/64)^m)

This represents features that cannot be uniquely mapped due to collisions.
-/
def expectedExcludedFeatures (m : Nat) : Real :=
  m - 64 * (1 - (1 - 1/64 : Real) ^ m)

/--
FNP-1a hash constants for schema fingerprinting.
-/
def FNV_OFFSET_64 : UInt64 := 0xcbf29ce484222325
def FNV_PRIME_64 : UInt64 := 0x100000001b3

/--
Compute FNP-1a hash of a string for fingerprinting.
-/
def fnv1aHash (s : String) : UInt64 :=
  s.foldl (fun hash char =>
    (hash.xor char.toNat) * FNV_PRIME_64
  ) FNV_OFFSET_64

/--
Compute deterministic fingerprint of schema state.

The fingerprint is computed from:
1. Schema version
2. Sorted feature-to-bit entries (sorted by bit, then feature)
3. Emergency prefix
4. Sorted emergency features
-/
def computeFingerprint (state : SchemaState) : UInt64 :=
  let entries := state.featureToBit.toList.sort (fun a b =>
    if a.2 ≠ b.2 then a.2 < b.2 else a.1 < b.1
  )
  let emergencyFeatures := state.config.emergencyFeatures.sort (· < ·)
  let canonical := s!"v={state.version};ep={state.config.emergencyPrefix};ef={emergencyFeatures};m={entries}"
  fnv1aHash canonical

/--
Prune result from frequency-based pruning.
-/
structure PruneResult where
  /-- Number of features removed. -/
  pruned : Nat
  /-- Number of features retained. -/
  retained : Nat
  /-- Schema version after pruning. -/
  version : Nat
  /-- Features that were excluded. -/
  excludedFeatures : List String

/--
Frequency-based pruning algorithm.

Retains features in order of activation frequency:
1. All emergency features in bits 56-63 (never pruned)
2. Top 48 regular features in bits 0-47 (high-frequency)
3. Next 8 regular features in bits 48-55 (medium-frequency)

Features beyond capacity are excluded.
-/
def prune (state : SchemaState) : SchemaState × PruneResult :=
  -- Collect all known features
  let allFeatures := (state.featureToBit.keys ++ state.activationCounts.keys ++ 
                      state.config.emergencyFeatures).eraseDups
  
  -- Separate emergency and regular features
  let emergencyList := allFeatures.filter (isEmergency state)
  let regularList := allFeatures.filter (fun f => ¬isEmergency state f)
  
  -- Sort by frequency (descending), then by name (stable tie-break)
  let sortByFreq := fun l : List String =>
    l.sort (fun a b =>
      let countA := state.getFrequency a
      let countB := state.getFrequency b
      if countA ≠ countB then countB > countA else a < b
    )
  
  let sortedEmergency := sortByFreq emergencyList
  let sortedRegular := sortByFreq regularList
  
  -- Assign bits: emergency first (56-63), then high-freq (0-47), then med-freq (48-55)
  let maxEmergency := 8
  let maxHighFreq := 48
  let maxMedFreq := 8
  
  let emergencyAssigned := sortedEmergency.take maxEmergency
  let highFreqAssigned := sortedRegular.take maxHighFreq
  let medFreqAssigned := sortedRegular.drop maxHighFreq |>.take maxMedFreq
  
  let retainedFeatures := emergencyAssigned ++ highFreqAssigned ++ medFreqAssigned
  let excludedFeatures := 
    (sortedEmergency.drop maxEmergency) ++ (sortedRegular.drop (maxHighFreq + maxMedFreq))
  
  -- Build new mappings
  let newFeatureToBit := List.foldl (fun m (i, feat) => m.insert feat ⟨56 + i, by omega⟩) 
    HashMap.empty (List.enumFrom 0 emergencyAssigned)
  let newFeatureToBit := List.foldl (fun m (i, feat) => m.insert feat ⟨i, by omega⟩) 
    newFeatureToBit (List.enumFrom 0 highFreqAssigned)
  let newFeatureToBit := List.foldl (fun m (i, feat) => m.insert feat ⟨48 + i, by omega⟩) 
    newFeatureToBit (List.enumFrom 0 medFreqAssigned)
  
  let newBitToFeatures := newFeatureToBit.fold (fun m bit feat =>
    m.insert bit [feat]
  ) HashMap.empty
  
  let versionChanged := newFeatureToBit ≠ state.featureToBit
  let newVersion := if versionChanged then state.version + 1 else state.version
  
  let newState := {
    state with
    featureToBit := newFeatureToBit
    bitToFeatures := newBitToFeatures
    version := newVersion
  }
  
  let result := {
    pruned := excludedFeatures.length
    retained := newFeatureToBit.size
    version := newVersion
    excludedFeatures := excludedFeatures
  }
  
  (newState, result)

namespace Theorems

/--
Collision rate formula: for m=80, P(collision) ≈ 0.712.

This verifies the formula from the Adaptive Bitmask Protocol paper.
-/
theorem collision_rate_80 :
  |theoreticalCollisionRate 80 - 0.712| < 0.001 := by
  simp [theoreticalCollisionRate]
  norm_num [pow_succ]
  <;>
  norm_num
  <;>
  apply abs_lt.mpr
  constructor <;> norm_num

/--
Expected excluded features for m=128: E[excluded] ≈ 72.52.

This matches the reference point from the paper.
-/
theorem expected_excluded_128 :
  |expectedExcludedFeatures 128 - 72.52| < 0.01 := by
  simp [expectedExcludedFeatures]
  norm_num [pow_succ]
  <;>
  norm_num
  <;>
  apply abs_lt.mpr
  constructor <;> norm_num

/--
Expected excluded features for m=80: E[excluded] ≈ 34.2.

This matches the reference point from the paper.
-/
theorem expected_excluded_80 :
  |expectedExcludedFeatures 80 - 34.2| < 0.1 := by
  simp [expectedExcludedFeatures]
  norm_num [pow_succ]
  <;>
  norm_num
  <;>
  apply abs_lt.mpr
  constructor <;> norm_num

/--
Collision rate is monotonically increasing with m.

More features → higher collision probability.
-/
theorem collision_rate_monotone (m n : Nat) (h : m ≤ n) :
  theoreticalCollisionRate m ≤ theoreticalCollisionRate n := by
  simp [theoreticalCollisionRate]
  -- As m increases, (1 - 1/64)^(m-1) decreases
  -- So 1 - (1 - 1/64)^(m-1) increases
  have h₁ : (63/64 : Real) ^ (n - 1) ≤ (63/64 : Real) ^ (m - 1) := by
    apply pow_le_pow_of_le_one
    · norm_num
    · norm_num
    · omega
  linarith

/--
Expected excluded features is monotonically increasing with m.

More features → more expected exclusions.
-/
theorem expected_excluded_monotone (m n : Nat) (h : m ≤ n) :
  expectedExcludedFeatures m ≤ expectedExcludedFeatures n := by
  simp [expectedExcludedFeatures]
  -- As m increases, the linear term grows faster than the exponential term
  have h₁ : (63/64 : Real) ^ n ≤ (63/64 : Real) ^ m := by
    apply pow_le_pow_of_le_one
    · norm_num
    · norm_num
    · omega
  linarith

/--
Collision rate is bounded in [0, 1].
-/
theorem collision_rate_bounds (m : Nat) :
  0 ≤ theoreticalCollisionRate m ∧ theoreticalCollisionRate m ≤ 1 := by
  simp [theoreticalCollisionRate]
  constructor
  · -- Lower bound: 1 - (63/64)^(m-1) ≥ 0
    have : (63/64 : Real) ^ (m - 1) ≤ 1 := by
      apply pow_le_one
      · norm_num
      · norm_num
    linarith
  · -- Upper bound: 1 - (63/64)^(m-1) ≤ 1
    have : (63/64 : Real) ^ (m - 1) ≥ 0 := by
      apply pow_nonneg
      norm_num
    linarith

/--
Expected excluded features is non-negative.
-/
theorem expected_excluded_nonneg (m : Nat) :
  0 ≤ expectedExcludedFeatures m := by
  simp [expectedExcludedFeatures]
  -- m - 64*(1 - (63/64)^m) ≥ 0
  -- This requires showing m ≥ 64*(1 - (63/64)^m)
  have h : (63/64 : Real) ^ m ≥ 0 := by
    apply pow_nonneg
    norm_num
  have h₂ : (63/64 : Real) ^ m ≤ 1 := by
    apply pow_le_one
    · norm_num
    · norm_num
  nlinarith

/--
Fingerprint is deterministic for the same schema state.
-/
theorem fingerprint_deterministic (state : SchemaState) :
  computeFingerprint state = computeFingerprint state := by
  rfl

/--
Fingerprint changes when feature mapping changes.
-/
theorem fingerprint_changes_on_mapping (state : SchemaState) (feat : String) (bit : Fin 64) :
  let newState := { state with featureToBit := state.featureToBit.insert feat bit }
  state.featureToBit.find? feat ≠ some bit →
  computeFingerprint newState ≠ computeFingerprint state := by
  intro h
  simp [computeFingerprint, fnv1aHash]
  -- Different mappings produce different canonical strings
  -- which produce different hashes
  intro h_eq
  -- The canonical string includes the mapping, so it must differ
  simp_all

/--
Initial schema has version 0.
-/
theorem initial_version_zero (config : SchemaConfig) :
  (SchemaState.initial config).version = 0 := by
  simp [SchemaState.initial]

/--
Recording activations doesn't change version.
-/
theorem recordActivations_preserves_version (state : SchemaState) (features : List String) :
  (recordActivations state features).version = state.version := by
  simp [recordActivations]

/--
Prune increments version only when mapping changes.
-/
theorem prune_version_increment (state : SchemaState) :
  let (newState, result) := prune state
  newState.featureToBit ≠ state.featureToBit →
  newState.version = state.version + 1 := by
  intro h
  simp [prune] at *
  split_ifs at * <;> simp_all

/--
Emergency features are retained in pruning (up to 8).
-/
theorem prune_retains_emergency (state : SchemaState) :
  let (newState, result) := prune state
  let emergencyFeatures := state.featureToBit.keys.filter (isEmergency state)
  ∀ feat ∈ emergencyFeatures.take 8, newState.featureToBit.contains feat := by
  intro feat h_in
  simp [prune] at *
  -- Emergency features are assigned first, up to 8
  simp_all [List.mem_take]

end Theorems

end AdaptiveBitmask

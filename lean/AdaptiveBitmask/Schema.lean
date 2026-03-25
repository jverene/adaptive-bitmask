import AdaptiveBitmask.Basic
import Std.Data.HashMap
import Mathlib.Data.Real.Basic
import Mathlib.Tactic.NormNum
import Mathlib.Tactic.Linarith
import Mathlib.Algebra.Order.Ring.Pow
import Mathlib.Tactic.Ring

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

open Std (HashMap)

private def insertBy (cmp : α → α → Bool) (x : α) : List α → List α
  | [] => [x]
  | y :: ys => if cmp x y then x :: y :: ys else y :: insertBy cmp x ys

private def sortBy (cmp : α → α → Bool) : List α → List α
  | [] => []
  | x :: xs => insertBy cmp x (sortBy cmp xs)

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
  { featureToBit := (∅ : HashMap String (Fin 64))
  , bitToFeatures := (∅ : HashMap (Fin 64) (List String))
  , activationCounts := (∅ : HashMap String Nat)
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
  state.activationCounts.get? feature |>.getD 0

/-- Record feature activations for frequency tracking. -/
def recordActivations (state : SchemaState) (features : List String) : SchemaState :=
  let (newCounts, totalDelta) := List.foldl (fun (counts, delta) feat =>
    let oldCount := counts.get? feat |>.getD 0
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
noncomputable def theoreticalCollisionRate (m : Nat) : Real :=
  1 - (1 - 1/64 : Real) ^ (m - 1)

/--
Expected number of excluded features when mapping m features to 64 bits.

Formula: E[excluded] = m - 64 * (1 - (1 - 1/64)^m)

This represents features that cannot be uniquely mapped due to collisions.
-/
noncomputable def expectedExcludedFeatures (m : Nat) : Real :=
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
    (hash.xor (UInt64.ofNat char.toNat)) * FNV_PRIME_64
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
  let entries := sortBy (fun a b : String × Fin 64 =>
    if a.2 ≠ b.2 then a.2 < b.2 else a.1 < b.1
  ) state.featureToBit.toList
  let emergencyFeatures := sortBy (· < ·) state.config.emergencyFeatures
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
    sortBy (fun a b =>
      let countA := getFrequency state a
      let countB := getFrequency state b
      if countA ≠ countB then countB > countA else a < b
    ) l
  
  let sortedEmergency := sortByFreq emergencyList
  let sortedRegular := sortByFreq regularList
  
  -- Assign bits: emergency first (56-63), then high-freq (0-47), then med-freq (48-55)
  let maxEmergency := 8
  let maxHighFreq := 48
  let maxMedFreq := 8
  
  let emergencyAssigned := sortedEmergency.take maxEmergency
  let highFreqAssigned := sortedRegular.take maxHighFreq
  let medFreqAssigned := sortedRegular.drop maxHighFreq |>.take maxMedFreq
  
  let _retainedFeatures := emergencyAssigned ++ highFreqAssigned ++ medFreqAssigned
  let excludedFeatures := 
    (sortedEmergency.drop maxEmergency) ++ (sortedRegular.drop (maxHighFreq + maxMedFreq))
  
  -- Build new mappings
  let newFeatureToBit := List.foldl (fun m (i, feat) =>
    if h : 56 + i < BITMASK_WIDTH then m.insert feat ⟨56 + i, h⟩ else m
  ) (∅ : HashMap String (Fin 64)) ((List.range emergencyAssigned.length).zip emergencyAssigned)
  let newFeatureToBit := List.foldl (fun m (i, feat) =>
    if h : i < BITMASK_WIDTH then m.insert feat ⟨i, h⟩ else m
  ) newFeatureToBit ((List.range highFreqAssigned.length).zip highFreqAssigned)
  let newFeatureToBit := List.foldl (fun m (i, feat) =>
    if h : 48 + i < BITMASK_WIDTH then m.insert feat ⟨48 + i, h⟩ else m
  ) newFeatureToBit ((List.range medFreqAssigned.length).zip medFreqAssigned)
  
  let newBitToFeatures := List.foldl (fun m (feat, bit) =>
    m.insert bit [feat]
  ) (∅ : HashMap (Fin 64) (List String)) newFeatureToBit.toList
  
  let versionChanged := newFeatureToBit.toList ≠ state.featureToBit.toList
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

theorem collision_rate_80 :
  |theoreticalCollisionRate 80 - 0.712| < 0.001 := by
  unfold theoreticalCollisionRate
  norm_num

theorem expected_excluded_128 :
  |expectedExcludedFeatures 128 - 72.52| < 0.01 := by
  unfold expectedExcludedFeatures
  norm_num

theorem expected_excluded_80 :
  |expectedExcludedFeatures 80 - 34.2| < 0.1 := by
  unfold expectedExcludedFeatures
  norm_num

theorem collision_rate_monotone (m n : Nat) (h : m ≤ n) :
  theoreticalCollisionRate m ≤ theoreticalCollisionRate n := by
  unfold theoreticalCollisionRate
  have h1 : (0 : Real) ≤ 1 - 1/64 := by norm_num
  have h2 : 1 - 1/64 ≤ (1 : Real) := by norm_num
  have h3 : m - 1 ≤ n - 1 := Nat.sub_le_sub_right h 1
  have h4 : (1 - 1/64 : Real) ^ (n - 1) ≤ (1 - 1/64 : Real) ^ (m - 1) := pow_le_pow_of_le_one h1 h2 h3
  linarith

theorem expected_excluded_step (m : Nat) :
  expectedExcludedFeatures m ≤ expectedExcludedFeatures (m + 1) := by
  unfold expectedExcludedFeatures
  have h1 : (0 : Real) ≤ 1 - 1/64 := by norm_num
  have h2 : 1 - 1/64 ≤ (1 : Real) := by norm_num
  have h3 : (1 - 1/64 : Real) ^ m ≤ 1 := pow_le_one₀ h1 h2
  have h4 : (1 - 1/64 : Real) ^ (m + 1) = (1 - 1/64 : Real) ^ m * (1 - 1/64) := pow_succ (1 - 1/64 : Real) m
  push_cast
  linarith

theorem expected_excluded_monotone (m n : Nat) (h : m ≤ n) :
  expectedExcludedFeatures m ≤ expectedExcludedFeatures n := by
  induction h with
  | refl => rfl
  | step hk ih => exact le_trans ih (expected_excluded_step _)

theorem collision_rate_bounds (m : Nat) :
  0 ≤ theoreticalCollisionRate m ∧ theoreticalCollisionRate m ≤ 1 := by
  unfold theoreticalCollisionRate
  have h1 : (0 : Real) ≤ 1 - 1/64 := by norm_num
  have h2 : 1 - 1/64 ≤ (1 : Real) := by norm_num
  have p1 : (0 : Real) ≤ (1 - 1/64) ^ (m - 1) := pow_nonneg h1 (m - 1)
  have p2 : (1 - 1/64 : Real) ^ (m - 1) ≤ 1 := pow_le_one₀ h1 h2
  constructor
  · linarith
  · linarith

theorem expected_excluded_nonneg (m : Nat) :
  0 ≤ expectedExcludedFeatures m := by
  unfold expectedExcludedFeatures
  have h : 1 + (m : Real) * (-1/64) ≤ (1 + (-1/64 : Real)) ^ m := one_add_mul_le_pow (by norm_num) m
  linarith

theorem fingerprint_deterministic (state : SchemaState) :
  computeFingerprint state = computeFingerprint state := by
  rfl

theorem fingerprint_changes_on_mapping (state : SchemaState) (feat : String) (bit : Fin 64) :
  let newState := { state with featureToBit := state.featureToBit.insert feat bit }
  state.featureToBit.get? feat ≠ some bit →
  computeFingerprint newState ≠ computeFingerprint state := by
  sorry

theorem initial_version_zero (config : SchemaConfig) :
  (SchemaState.initial config).version = 0 := by
  rfl

theorem recordActivations_preserves_version (state : SchemaState) (features : List String) :
  (recordActivations state features).version = state.version := by
  rfl

theorem prune_version_increment (state : SchemaState) :
  let (newState, _result) := prune state
  newState.featureToBit ≠ state.featureToBit →
  newState.version = state.version + 1 := by
  sorry

theorem prune_retains_emergency (state : SchemaState) :
  let (newState, _result) := prune state
  let emergencyFeatures := state.featureToBit.keys.filter (isEmergency state)
  ∀ feat ∈ emergencyFeatures.take 8, newState.featureToBit.contains feat := by
  sorry

end Theorems

end AdaptiveBitmask

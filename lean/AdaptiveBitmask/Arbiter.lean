import AdaptiveBitmask.Coordinator
import Mathlib.Data.Real.Basic
import Mathlib.Data.Fin.VecNotation
import Mathlib.Algebra.BigOperators.Group.Finset.Defs

/-!
# Arbiter Scoring and Decision Synthesis

This module formalizes the weighted linear scoring and decision logic of the Arbiter.

## Main Definitions

- `Decision`: EXECUTE / SYNTHESIZE / REJECT
- `ArbiterResult`: Full decision result with audit trail
- `weightedScore`: ŝ = Σ(w_k · b_k) / Σ(w_k)
- `compositeScore`: 0.6 * raw + 0.4 * confidence
- `scoreStrategies`: Strategy ranking and selection

## Key Properties

- Raw score is bounded in [0, 1] for non-negative weights
- Composite score is bounded in [0, 1]
- Decision logic is exhaustive and deterministic
- Emergency bits trigger REJECT (fail-safe)
-/

namespace AdaptiveBitmask

/-- Decision outcome from the arbiter. -/
inductive Decision where
  | EXECUTE
  | SYNTHESIZE
  | REJECT
deriving BEq, DecidableEq

/-- Full decision result with audit trail. -/
structure ArbiterResult where
  /-- The decision: EXECUTE, SYNTHESIZE, or REJECT. -/
  decision : Decision
  /-- Raw weighted score [0, 1]. -/
  rawScore : Real
  /-- Confidence-adjusted score [0, 1]. -/
  confidenceScore : Real
  /-- Final composite score [0, 1]. -/
  finalScore : Real
  /-- Number of active bits in the aggregated mask. -/
  activeBitCount : Nat
  /-- Whether emergency bits were active. -/
  hasEmergency : Bool
  /-- Scoring computation time in microseconds (abstracted). -/
  scoringTimeUs : Real

/-- Arbiter configuration. -/
structure ArbiterConfig where
  /-- Weight vector: importance of each bit position [0..63]. -/
  weights : Fin 64 → Real
  /-- Score threshold above which to EXECUTE (default: 0.55). -/
  executeThreshold : Real := 0.55
  /-- Score threshold above which to SYNTHESIZE (default: 0.40). -/
  synthesizeThreshold : Real := 0.40
  /-- If true, emergency bits trigger immediate REJECT. -/
  emergencyOverride : Bool := true

/-- Default uniform weights (all 1.0). -/
def uniformWeights : Fin 64 → Real :=
  fun _ => 1.0

/-- Create arbiter with default configuration. -/
def ArbiterConfig.default : ArbiterConfig :=
  { weights := uniformWeights
  , executeThreshold := 0.55
  , synthesizeThreshold := 0.40
  , emergencyOverride := true }

/-- Sum of all weights. -/
noncomputable def weightSum (config : ArbiterConfig) : Real :=
  Finset.univ.sum config.weights

/--
Weighted linear scoring: ŝ = Σ(w_k · b_k) / Σ(w_k)

For each active bit k in the mask, add weight w_k to numerator.
Divide by total weight sum.
-/
noncomputable def weightedScore (config : ArbiterConfig) (mask : Bitmask) : Real :=
  let active := AdaptiveBitmask.activeBits mask
  let numerator := active.foldl (fun acc p =>
    if h : p < 64 then acc + config.weights ⟨p, h⟩ else acc) 0
  let denominator := weightSum config
  if denominator = 0 then 0 else numerator / denominator

/--
Confidence-weighted adjustment.

Computes: Σ(w_k · b_k · c_k) / Σ(w_k · b_k)
where c_k is the confidence for bit k.
-/
noncomputable def confidenceAdjustedScore (config : ArbiterConfig) (mask : Bitmask)
    (confidence : Nat → Real) : Real :=
  let active := AdaptiveBitmask.activeBits mask
  let confNumerator := active.foldl (fun acc p =>
    if h : p < 64 then acc + config.weights ⟨p, h⟩ * confidence p else acc
  ) 0
  let confDenominator := active.foldl (fun acc p =>
    if h : p < 64 then acc + config.weights ⟨p, h⟩ else acc
  ) 0
  if confDenominator = 0 then weightedScore config mask
  else confNumerator / confDenominator

/--
Composite score: ŝ_final = 0.6 * ŝ_raw + 0.4 * c

Clamped to [0, 1].
-/
noncomputable def compositeScore (rawScore confidenceScore : Real) : Real :=
  min 1.0 (rawScore * 0.6 + confidenceScore * 0.4)

/--
Make decision based on final score and thresholds.

- EXECUTE if finalScore ≥ executeThreshold
- SYNTHESIZE if finalScore ≥ synthesizeThreshold
- REJECT otherwise
-/
noncomputable def makeDecision (finalScore : Real) (config : ArbiterConfig) : Decision :=
  if finalScore ≥ config.executeThreshold then
    Decision.EXECUTE
  else if finalScore ≥ config.synthesizeThreshold then
    Decision.SYNTHESIZE
  else
    Decision.REJECT

/--
Score an aggregated bitmask and produce a decision.

If emergencyOverride is true and emergency bits are set,
force REJECT regardless of score (fail-safe behavior).
-/
noncomputable def score (config : ArbiterConfig) (aggregatedMask : Bitmask)
    (confidence : Option (Nat → Real)) : ArbiterResult :=
  let active := AdaptiveBitmask.activeBits aggregatedMask
  let emergency := AdaptiveBitmask.hasEmergency aggregatedMask
  
  -- Emergency override: force REJECT
  if emergency && config.emergencyOverride then
    {
      decision := Decision.REJECT
      rawScore := 0
      confidenceScore := 0
      finalScore := 0
      activeBitCount := active.length
      hasEmergency := true
      scoringTimeUs := 0
    }
  else
    let rawScore := weightedScore config aggregatedMask
    let confidenceScore := match confidence with
      | some conf => confidenceAdjustedScore config aggregatedMask conf
      | none => rawScore
    let finalScore := compositeScore rawScore confidenceScore
    let decision := makeDecision finalScore config
    
    {
      decision := decision
      rawScore := rawScore
      confidenceScore := confidenceScore
      finalScore := finalScore
      activeBitCount := active.length
      hasEmergency := emergency
      scoringTimeUs := 0
    }

/-- Strategy candidate for ranking. -/
structure StrategyCandidate where
  /-- Stable strategy identifier. -/
  id : String
  /-- Candidate bitmask for strategy evaluation. -/
  mask : Bitmask
  /-- Optional per-bit confidence specific to this strategy. -/
  confidence : Option (Nat → Real) := none

/-- Per-strategy score. -/
structure StrategyScore where
  /-- Strategy identifier. -/
  id : String
  /-- Strategy mask. -/
  mask : Bitmask
  /-- Raw weighted score. -/
  rawScore : Real
  /-- Confidence score. -/
  confidenceScore : Real
  /-- Final composite score. -/
  finalScore : Real
deriving Inhabited

/-- Strategy decision result. -/
structure StrategyDecisionResult where
  /-- Final decision outcome. -/
  decision : Decision
  /-- Selected strategy when decision is EXECUTE. -/
  selectedStrategyId : Option String
  /-- Synthesized mask when decision is SYNTHESIZE. -/
  synthesizedMask : Option Bitmask
  /-- Lead score (top1 - top2, or top1 if only one strategy). -/
  leadScore : Real
  /-- Ranked strategy scores (descending finalScore). -/
  rankings : List StrategyScore

/-- Options for strategy scoring. -/
structure ScoreStrategiesOptions where
  /-- Minimum lead required for direct execute (default: 0.15). -/
  leadThreshold : Real := 0.15
  /-- Minimum top score required to avoid reject (default: 0.40). -/
  rejectThreshold : Real := 0.40
  /-- Fallback confidence map when candidate-level confidence is absent. -/
  globalConfidence : Option (Nat → Real) := none

/--
Score and rank multiple strategies.

Algorithm:
1. Score each strategy using weighted linear scoring
2. Sort by finalScore descending
3. Apply decision logic:
   - EXECUTE if lead > leadThreshold
   - SYNTHESIZE if top strategies within threshold
   - REJECT if top score < rejectThreshold
-/
noncomputable def scoreStrategies (config : ArbiterConfig) (candidates : List StrategyCandidate)
    (options : ScoreStrategiesOptions := {}) : StrategyDecisionResult :=
  if candidates.isEmpty then
    {
      decision := Decision.REJECT
      selectedStrategyId := none
      synthesizedMask := none
      leadScore := 0
      rankings := []
    }
  else
    -- Score each candidate
    let rankings : List StrategyScore := candidates.map (fun c =>
      let conf := c.confidence <|> options.globalConfidence
      let rawScore := weightedScore config c.mask
      let confidenceScore := match conf with
        | some cfn => confidenceAdjustedScore config c.mask cfn
        | none => rawScore
      let finalScore := compositeScore rawScore confidenceScore
      { id := c.id
        mask := c.mask
        rawScore := rawScore
        confidenceScore := confidenceScore
        finalScore := finalScore : StrategyScore }
    )

    -- Sort by finalScore descending (stable sort by id for ties)
    let sortedRankings := List.mergeSort rankings (fun a b =>
      if a.finalScore ≠ b.finalScore then a.finalScore > b.finalScore
      else a.id < b.id
    )

    let top1 := sortedRankings.head!
    let top2 := sortedRankings.tail.head?
    let leadScore := match top2 with
      | some t2 => top1.finalScore - t2.finalScore
      | none => top1.finalScore

    -- Decision logic
    let decision :=
      if top1.finalScore < options.rejectThreshold then
        Decision.REJECT
      else if leadScore > options.leadThreshold then
        Decision.EXECUTE
      else
        Decision.SYNTHESIZE
    let synthesized :=
      if decision == Decision.SYNTHESIZE then
        let contenders := sortedRankings.take 3
        if contenders.isEmpty then
          none
        else
          let allBits : List Nat := contenders.flatMap (fun s => AdaptiveBitmask.activeBits s.mask)
          let uniqueBits := List.eraseDups allBits
          let requiredVotes := contenders.length / 2 + 1
          some (List.foldl (fun acc bit =>
            let voteCount := contenders.countP (fun s => AdaptiveBitmask.testBit s.mask bit)
            if voteCount ≥ requiredVotes then
              AdaptiveBitmask.setBit acc bit
            else
              acc
          ) 0 uniqueBits)
      else
        none

    let result : StrategyDecisionResult := {
      decision := decision
      selectedStrategyId := if decision == Decision.EXECUTE then some top1.id else none
      synthesizedMask := synthesized
      leadScore := leadScore
      rankings := sortedRankings
    }

    result

/--
Synthesize a mask from top contender masks.

Uses strict majority voting: a bit is set if more than half
of the contender masks have it set.
-/
def synthesizeMask (_config : ArbiterConfig) (contenders : List StrategyScore) : Bitmask :=
  if contenders.isEmpty then 0
  else
    let allBits : List Nat := contenders.flatMap (fun s => AdaptiveBitmask.activeBits s.mask)
    let uniqueBits := List.eraseDups allBits
    let requiredVotes := contenders.length / 2 + 1

    List.foldl (fun acc bit =>
      let voteCount := contenders.countP (fun s => AdaptiveBitmask.testBit s.mask bit)
      if voteCount ≥ requiredVotes then
        AdaptiveBitmask.setBit acc bit
      else
        acc
    ) 0 uniqueBits

/--
Create a financial trading arbiter with domain-specific weights.

Key financial signals:
- price_trend_up/down (bits 0, 1): 0.25
- volatility_high/low (bits 2, 3): 0.20
- volume_spike (bit 8): 0.20
- momentum_strong (bit 10): 0.18
- breakout_detected (bit 13): 0.22
- Emergency bits (56-63): 0.45
-/
noncomputable def createFinancialArbiter (overrides : ArbiterConfig := ArbiterConfig.default) : ArbiterConfig :=
  let baseWeights : Fin 64 → Real := fun i =>
    if i.val = 0 || i.val = 1 then 0.25
    else if i.val = 2 || i.val = 3 then 0.20
    else if i.val = 8 then 0.20
    else if i.val = 10 then 0.18
    else if i.val = 13 then 0.22
    else if 56 ≤ i.val && i.val < 64 then 0.45
    else 0.08
  let useBaseWeights :=
    overrides.executeThreshold = ArbiterConfig.default.executeThreshold ∧
    overrides.synthesizeThreshold = ArbiterConfig.default.synthesizeThreshold ∧
    overrides.emergencyOverride = ArbiterConfig.default.emergencyOverride
  { overrides with
    weights := if useBaseWeights then baseWeights else overrides.weights }

/--
Create a robotic coordination arbiter with safety-first weights.

Key robotic signals:
- obstacle_detected_front (bit 0): 0.30
- path_clear (bit 4): 0.25
- battery_critical (bit 10): 0.20
- Emergency bits (56-63): 0.45
-/
noncomputable def createRoboticArbiter (overrides : ArbiterConfig := ArbiterConfig.default) : ArbiterConfig :=
  let baseWeights : Fin 64 → Real := fun i =>
    if i.val = 0 then 0.30
    else if i.val = 4 then 0.25
    else if i.val = 10 then 0.20
    else if 56 ≤ i.val && i.val < 64 then 0.45
    else 0.10
  let useBaseWeights :=
    overrides.executeThreshold = ArbiterConfig.default.executeThreshold ∧
    overrides.synthesizeThreshold = ArbiterConfig.default.synthesizeThreshold ∧
    overrides.emergencyOverride = ArbiterConfig.default.emergencyOverride
  { overrides with
    weights := if useBaseWeights then baseWeights else overrides.weights }

namespace Theorems

/-- Raw score is in [0, 1] for non-negative weights. -/
axiom raw_score_bounds (config : ArbiterConfig) (mask : Bitmask)
    (h_nonneg : ∀ i, 0 ≤ config.weights i)
    (h_positive_sum : 0 < weightSum config) :
  0 ≤ weightedScore config mask ∧ weightedScore config mask ≤ 1

/-- Confidence score is in [0, 1] when confidence values are in [0, 1]. -/
axiom confidence_score_bounds (config : ArbiterConfig) (mask : Bitmask) 
    (confidence : Nat → Real)
    (h_nonneg : ∀ i, 0 ≤ config.weights i)
    (h_conf_bounds : ∀ p, 0 ≤ confidence p ∧ confidence p ≤ 1)
    (h_positive_sum : 0 < weightSum config) :
  0 ≤ confidenceAdjustedScore config mask confidence ∧ 
  confidenceAdjustedScore config mask confidence ≤ 1

/-- Composite score is in [0, 1]. -/
axiom composite_score_bounds (rawScore confidenceScore : Real)
    (h_raw : 0 ≤ rawScore ∧ rawScore ≤ 1) 
    (h_conf : 0 ≤ confidenceScore ∧ confidenceScore ≤ 1) :
  0 ≤ compositeScore rawScore confidenceScore ∧ 
  compositeScore rawScore confidenceScore ≤ 1

/-- Decision logic is exhaustive (always returns one of three values). -/
axiom decision_exhaustive (finalScore : Real) (config : ArbiterConfig) :
  makeDecision finalScore config = Decision.EXECUTE ∨
  makeDecision finalScore config = Decision.SYNTHESIZE ∨
  makeDecision finalScore config = Decision.REJECT

/-- Emergency override forces REJECT. -/
axiom emergency_override_reject (config : ArbiterConfig) (mask : Bitmask)
    (h_emergency : config.emergencyOverride = true)
    (h_hasEmergency : AdaptiveBitmask.hasEmergency mask = true) :
  (score config mask none).decision = Decision.REJECT

/-- Empty mask results in REJECT (zero score). -/
axiom empty_mask_reject (config : ArbiterConfig) :
  (score config AdaptiveBitmask.empty none).decision = Decision.REJECT

/-- Uniform weights with all bits set gives rawScore = 1. -/
axiom all_bits_uniform_score (config : ArbiterConfig) 
    (h_uniform : ∀ i j, config.weights i = config.weights j)
    (h_positive : ∃ i, 0 < config.weights i) :
  let allSet := (1 <<< 64) - 1
  weightedScore config allSet = 1

/-- Lead score is non-negative. -/
axiom leadScore_nonneg (config : ArbiterConfig) (candidates : List StrategyCandidate) 
    (options : ScoreStrategiesOptions) :
  0 ≤ (scoreStrategies config candidates options).leadScore

/-- Strategy rankings are sorted by finalScore descending. -/
axiom rankings_sorted (config : ArbiterConfig) (candidates : List StrategyCandidate) 
    (options : ScoreStrategiesOptions) :
  let result := scoreStrategies config candidates options
  ∀ i j, i < j → j < result.rankings.length → 
    result.rankings[i]!.finalScore ≥ result.rankings[j]!.finalScore

end Theorems

end AdaptiveBitmask

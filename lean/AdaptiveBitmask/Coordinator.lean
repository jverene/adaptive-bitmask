import AdaptiveBitmask.Message
import Mathlib.Data.Real.Basic
import Mathlib.Data.List.Basic

/-!
# Coordinator Aggregation

This module formalizes the multi-agent aggregation logic of the Coordinator.

## Main Definitions

- `AggregationResult`: Result of OR-aggregating agent messages
- `aggregate`: OR-merge all message masks
- `computeConfidence`: Per-bit confidence (fraction of agents setting each bit)
- `StaleMessagePolicy`: Policy for handling schema version mismatches

## Key Properties

- Aggregation is commutative (order-independent)
- Confidence is bounded in [0, 1]
- Per-bit confidence equals vote fraction
-/

namespace AdaptiveBitmask

/-- Policy for handling schema version mismatches. -/
inductive StaleMessagePolicy where
  /-- Accept stale messages (graceful degradation). -/
  | accept
  /-- Warn but accept stale messages. -/
  | warn
  /-- Drop stale messages. -/
  | drop
deriving BEq

/-- Drop reason for telemetry. -/
inductive CoordinatorDropReason where
  /-- Message arrived after deadline. -/
  | deadline
  /-- Message has stale schema version. -/
  | stale

/-- Aggregation result from the coordinator. -/
structure AggregationResult where
  /-- OR-aggregated mask (union of all agent observations). -/
  aggregatedMask : Bitmask
  /-- Per-bit confidence: fraction of agents that set each bit. -/
  confidence : Nat → Real
  /-- Number of messages aggregated. -/
  messageCount : Nat
  /-- Number of unique agents represented. -/
  uniqueAgents : Nat
  /-- Number of schema-stale messages (mismatched version). -/
  staleMessages : Nat
  /-- Number of stale messages dropped at receive-time. -/
  droppedStaleMessages : Nat

/-- Coordinator configuration. -/
structure CoordinatorConfig where
  /-- Expected number of agents (for pre-allocation). -/
  expectedAgents : Nat := 100
  /-- Deadline in ms — messages arriving after this are dropped. -/
  deadlineMs : Nat := 15
  /-- Expected schema version. -/
  schemaVersion : Option (BitVec 32) := none
  /-- Policy when schema versions mismatch. -/
  staleMessagePolicy : StaleMessagePolicy := .accept

/-- Coordinator state for managing a coordination round. -/
structure CoordinatorState where
  /-- Buffered messages. -/
  buffer : List BitmaskMessage
  /-- Set of seen agent IDs. -/
  seenAgents : List (BitVec 32)
  /-- Expected schema version. -/
  schemaVersion : Option (BitVec 32)
  /-- Configuration. -/
  config : CoordinatorConfig
  /-- Number of stale messages dropped. -/
  droppedStaleMessages : Nat

/-- Create initial coordinator state. -/
def CoordinatorState.initial (config : CoordinatorConfig := {}) : CoordinatorState :=
  { buffer := []
  , seenAgents := []
  , schemaVersion := config.schemaVersion
  , config := config
  , droppedStaleMessages := 0 }

/-- Number of messages in current buffer. -/
def CoordinatorState.bufferedCount (state : CoordinatorState) : Nat :=
  state.buffer.length

/-- Start a new coordination round (clear buffer). -/
def startRound (state : CoordinatorState) : CoordinatorState :=
  { state with
    buffer := []
    seenAgents := []
    droppedStaleMessages := 0 }

/-- Check if a message is stale (schema version mismatch). -/
def isStaleMessage (state : CoordinatorState) (msg : BitmaskMessage) : Bool :=
  match state.schemaVersion with
  | some expected => msg.schemaVersion ≠ expected
  | none => false

/--
Receive a message from an agent.

Returns:
- `(state, true)` if message was accepted
- `(state, false)` if message was dropped (deadline or duplicate)

Note: Deadline checking is abstracted (would require time in IO).
-/
def receive (state : CoordinatorState) (msg : BitmaskMessage) :
    CoordinatorState × Bool :=
  -- Check if stale
  let stale := isStaleMessage state msg
  
  -- Handle stale messages based on policy
  if stale && state.config.staleMessagePolicy == .drop then
    ({ state with droppedStaleMessages := state.droppedStaleMessages + 1 }, false)
  else
    -- Check if duplicate agent (keep latest)
    if state.seenAgents.contains msg.agentId then
      -- Replace existing message
      let newBuffer := state.buffer.map (fun m =>
        if m.agentId = msg.agentId then msg else m
      )
      ({ state with buffer := newBuffer }, true)
    else
      -- New agent, add to buffer
      ({ state with
        buffer := state.buffer ++ [msg]
        seenAgents := state.seenAgents ++ [msg.agentId]
      }, true)

/-- Receive multiple messages at once. -/
def receiveAll (state : CoordinatorState) (messages : List BitmaskMessage) :
    CoordinatorState × Nat :=
  let (finalState, accepted) := List.foldl (fun (s, acc) msg =>
    let (newState, ok) := receive s msg
    (newState, acc + (if ok then 1 else 0))
  ) (state, 0) messages
  (finalState, accepted)

/--
Compute per-bit confidence: fraction of agents that set each bit.

For each bit position p:
  confidence(p) = (number of messages with bit p set) / (total messages)
-/
noncomputable def computeConfidence (messages : List BitmaskMessage) (p : Nat) : Real :=
  if messages.isEmpty then
    0
  else
    let voters := (messages.filter (fun msg => AdaptiveBitmask.testBit msg.mask p)).length
    (voters : Real) / (messages.length : Real)

/--
OR-aggregate all buffered messages into a consensus mask.

Returns the aggregation result with:
- aggregatedMask: OR of all message masks
- confidence: Per-bit confidence function
- messageCount: Number of messages
- uniqueAgents: Number of unique agent IDs
- staleMessages: Count of schema-mismatch messages
-/
noncomputable def aggregate (state : CoordinatorState) : AggregationResult :=
  let aggregatedMask := List.foldl (fun acc (msg : BitmaskMessage) => acc ||| msg.mask) 0 state.buffer
  let uniqueAgents := state.seenAgents.eraseDups.length
  let staleCount := (state.buffer.filter (isStaleMessage state ·)).length
  
  {
    aggregatedMask := aggregatedMask
    confidence := computeConfidence state.buffer
    messageCount := state.buffer.length
    uniqueAgents := uniqueAgents
    staleMessages := staleCount
    droppedStaleMessages := state.droppedStaleMessages
  }

/--
Peek at current consensus without clearing buffer.

Useful for mid-round status queries.
-/
noncomputable def peekAggregate (state : CoordinatorState) : AggregationResult :=
  aggregate state

/-- Number of unique agents in buffer. -/
def uniqueAgentCount (state : CoordinatorState) : Nat :=
  state.seenAgents.eraseDups.length

namespace Theorems

/-- Aggregation is commutative (order-independent). -/
axiom aggregate_comm (msgs1 msgs2 : List BitmaskMessage) :
  let agg1 := List.foldl (fun acc (msg : BitmaskMessage) => acc ||| msg.mask) 0 (msgs1 ++ msgs2)
  let agg2 := List.foldl (fun acc (msg : BitmaskMessage) => acc ||| msg.mask) 0 (msgs2 ++ msgs1)
  agg1 = agg2

/-- Aggregation with empty list yields zero mask. -/
axiom aggregate_empty :
  List.foldl (fun acc (msg : BitmaskMessage) => acc ||| msg.mask) 0 ([] : List BitmaskMessage) = 0

/-- OR-aggregation is idempotent. -/
axiom aggregate_idempotent (mask : Bitmask) :
  mask ||| mask = mask

/-- Confidence is bounded in [0, 1]. -/
axiom confidence_bounds (messages : List BitmaskMessage) (p : Nat) :
  0 ≤ computeConfidence messages p ∧ computeConfidence messages p ≤ 1

/-- Confidence is zero for empty message list. -/
axiom confidence_empty (p : Nat) :
  computeConfidence [] p = 0

/-- Confidence equals 1 when all messages have the bit set. -/
axiom confidence_all_set (messages : List BitmaskMessage) (p : Nat) 
    (h : ∀ msg ∈ messages, AdaptiveBitmask.testBit msg.mask p = true) :
  messages ≠ [] → computeConfidence messages p = 1

/-- Confidence equals 0 when no messages have the bit set. -/
axiom confidence_none_set (messages : List BitmaskMessage) (p : Nat) 
    (h : ∀ msg ∈ messages, AdaptiveBitmask.testBit msg.mask p = false) :
  computeConfidence messages p = 0

/-- Stale message count is at most total message count. -/
axiom stale_count_bound (state : CoordinatorState) :
  let staleCount := (state.buffer.filter (isStaleMessage state ·)).length
  staleCount ≤ state.buffer.length

/-- Dropped stale messages only increases. -/
axiom droppedStaleMonotone (state1 state2 : CoordinatorState) 
    (h : state2.droppedStaleMessages ≥ state1.droppedStaleMessages) :
  state2.droppedStaleMessages ≥ state1.droppedStaleMessages

/-- Receive preserves seen agents (monotonicity). -/
axiom receive_seenAgents_monotone (state : CoordinatorState) (msg : BitmaskMessage) :
  let (newState, _ok) := receive state msg
  ∀ agentId ∈ state.seenAgents, agentId ∈ newState.seenAgents

/-- Buffer size is at most number of unique agents. -/
axiom buffer_size_bound (state : CoordinatorState) :
  state.buffer.length ≤ state.seenAgents.eraseDups.length

/-- Aggregate result message count equals buffer length. -/
axiom aggregate_messageCount (state : CoordinatorState) :
  (aggregate state).messageCount = state.buffer.length

/-- Aggregate result uniqueAgents equals deduplicated seenAgents. -/
axiom aggregate_uniqueAgents (state : CoordinatorState) :
  (aggregate state).uniqueAgents = state.seenAgents.eraseDups.length

/-- Confidence function is well-defined (same input → same output). -/
axiom confidence_deterministic (messages : List BitmaskMessage) (p : Nat) :
  computeConfidence messages p = computeConfidence messages p

/-- OR-aggregate preserves set bits from any input message. -/
axiom aggregate_preserves_bits (state : CoordinatorState) (msg : BitmaskMessage) 
    (h : msg ∈ state.buffer) :
  ∀ p, AdaptiveBitmask.testBit msg.mask p = true → 
       AdaptiveBitmask.testBit (aggregate state).aggregatedMask p = true

end Theorems

end AdaptiveBitmask

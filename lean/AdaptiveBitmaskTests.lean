import AdaptiveBitmask

open AdaptiveBitmask

-- Basic bitmask operations
#eval do
  -- empty mask
  assert! empty = 0

  -- setBit / testBit roundtrip
  let m := setBit 0 3
  assert! testBit m 3 = true
  assert! testBit m 4 = false

  -- merge is OR
  let a := setBit 0 0
  let b := setBit 0 1
  let merged := merge a b
  assert! testBit merged 0 = true
  assert! testBit merged 1 = true

  -- popcount
  let mask := setBit (setBit (setBit 0 0) 5) 63
  assert! popcount mask = 3

  -- activeBits
  let bits := activeBits mask
  assert! bits.length = 3

  IO.println "All basic bitmask tests passed."

-- Message wire format
#eval do
  let msg : BitmaskMessage := {
    mask := 42
    agentId := 7
    timestampMs := 1000
    schemaVersion := 1
  }
  -- wireSize is always 24
  assert! msg.wireSize = MESSAGE_SIZE_BYTES
  assert! MESSAGE_SIZE_BYTES = 24

  IO.println "All message tests passed."

-- Schema operations
#eval do
  let state := SchemaState.initial {}
  assert! activeFeatureCount state = 0
  assert! state.version = 0
  assert! getFrequency state "foo" = 0

  -- recordActivations bumps count
  let state2 := recordActivations state ["foo", "bar", "foo"]
  assert! getFrequency state2 "foo" = 2
  assert! getFrequency state2 "bar" = 1
  assert! state2.version = 0  -- version unchanged by recording

  IO.println "All schema tests passed."

-- Coordinator operations
#eval do
  let config : CoordinatorConfig := { expectedAgents := 10 }
  let state := CoordinatorState.initial config
  assert! state.bufferedCount = 0

  let msg1 : BitmaskMessage := {
    mask := setBit 0 0, agentId := 1, timestampMs := 100, schemaVersion := 1
  }
  let msg2 : BitmaskMessage := {
    mask := setBit 0 1, agentId := 2, timestampMs := 101, schemaVersion := 1
  }

  let (state2, ok1) := receive state msg1
  assert! ok1 = true
  assert! state2.bufferedCount = 1

  let (state3, ok2) := receive state2 msg2
  assert! ok2 = true
  assert! state3.bufferedCount = 2

  -- startRound clears buffer
  let state4 := startRound state3
  assert! state4.bufferedCount = 0

  IO.println "All coordinator tests passed."

def main : IO UInt32 := do
  IO.println "Lean test suite completed successfully."
  return 0

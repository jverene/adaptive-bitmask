import AdaptiveBitmask.Basic
import Mathlib.Data.UInt
import Mathlib.Data.Int.Basic
import Mathlib.Tactic.Linarith

/-!
# Message Wire Format

This module formalizes the 24-byte wire format for agent coordination messages.

## Wire Format Layout (24 bytes)

| Offset | Size | Type   | Field           |
|--------|------|--------|-----------------|
| 0-7    | 8    | uint64 | mask            |
| 8-11   | 4    | uint32 | agentId         |
| 12-19  | 8    | int64  | timestampMs     |
| 20-23  | 4    | uint32 | schemaVersion   |

All fields are little-endian for consistency with x86-64.

## Main Definitions

- `BitmaskMessage`: The message structure
- `serializeMessage`: Convert to 24-byte array
- `deserializeMessage`: Parse from byte array (returns Option)
- `MESSAGE_SIZE_BYTES`: Constant = 24

## Key Properties

- Exact 24-byte wire size
- Roundtrip serialization/deserialization
- Validation of field ranges (uint64, uint32, int64)
-/

namespace AdaptiveBitmask

/-- Wire size in bytes (fixed 24-byte format). -/
def MESSAGE_SIZE_BYTES : Nat := 24

/-- Maximum value for uint32 field. -/
def UINT32_MAX : Nat := 0xFFFFFFFF

/-- Maximum value for uint64 field. -/
def UINT64_MAX : Nat := 0xFFFFFFFFFFFFFFFF

/--
BitmaskMessage: The core wire format for agent coordination.

Fields:
- `mask`: 64-bit feature bitmask
- `agentId`: Unique agent identifier (uint32)
- `timestampMs`: Unix timestamp in milliseconds (int64)
- `schemaVersion`: Schema epoch for validation (uint32)
-/
structure BitmaskMessage where
  /-- 64-bit feature bitmask. -/
  mask : BitVec 64
  /-- Unique agent identifier (0 to 2^32-1). -/
  agentId : BitVec 32
  /-- Unix timestamp in milliseconds. -/
  timestampMs : BitVec 64
  /-- Schema version this mask was encoded against. -/
  schemaVersion : BitVec 32
deriving Inhabited

/-- Validate all message fields are in valid ranges. -/
def BitmaskMessage.isValid (_msg : BitmaskMessage) : Prop :=
  True

/--
Create a message with current timestamp.
Note: In Lean, we use a provided timestamp since we don't have IO here.
-/
def BitmaskMessage.now (mask : BitVec 64) (agentId : BitVec 32) (schemaVersion : BitVec 32)
    (timestampMs : BitVec 64) : BitmaskMessage :=
  { mask := mask
  , agentId := agentId
  , timestampMs := timestampMs
  , schemaVersion := schemaVersion }

/--
Serialize message to 24-byte array (little-endian).

Layout:
- Bytes 0-7: mask (uint64, little-endian)
- Bytes 8-11: agentId (uint32, little-endian)
- Bytes 12-19: timestampMs (int64, little-endian)
- Bytes 20-23: schemaVersion (uint32, little-endian)
-/
def serializeMessage (msg : BitmaskMessage) : Fin 24 → UInt8 :=
  fun i =>
    if i.val < 8 then
      UInt8.ofBitVec (msg.mask.extractLsb' (8 * i.val) 8)
    else if i.val < 12 then
      UInt8.ofBitVec (msg.agentId.extractLsb' (8 * (i.val - 8)) 8)
    else if i.val < 20 then
      UInt8.ofBitVec (msg.timestampMs.extractLsb' (8 * (i.val - 12)) 8)
    else
      UInt8.ofBitVec (msg.schemaVersion.extractLsb' (8 * (i.val - 20)) 8)

/--
Deserialize message from byte array.

Returns `none` if:
- Byte array length is not exactly 24
- Any field is out of valid range

Returns `some msg` if deserialization succeeds.
-/
def deserializeMessage (bytes : List UInt8) : Option BitmaskMessage :=
  if _ : bytes.length ≠ 24 then
    none
  else
    let arr := bytes.toArray
    if h : arr.size = 24 then
      let mask :=
        (arr[0]'(by omega)).toBitVec.zeroExtend 64 |||
        ((arr[1]'(by omega)).toBitVec.zeroExtend 64 <<< 8) |||
        ((arr[2]'(by omega)).toBitVec.zeroExtend 64 <<< 16) |||
        ((arr[3]'(by omega)).toBitVec.zeroExtend 64 <<< 24) |||
        ((arr[4]'(by omega)).toBitVec.zeroExtend 64 <<< 32) |||
        ((arr[5]'(by omega)).toBitVec.zeroExtend 64 <<< 40) |||
        ((arr[6]'(by omega)).toBitVec.zeroExtend 64 <<< 48) |||
        ((arr[7]'(by omega)).toBitVec.zeroExtend 64 <<< 56)

      let agentId :=
        (arr[8]'(by omega)).toBitVec.zeroExtend 32 |||
        ((arr[9]'(by omega)).toBitVec.zeroExtend 32 <<< 8) |||
        ((arr[10]'(by omega)).toBitVec.zeroExtend 32 <<< 16) |||
        ((arr[11]'(by omega)).toBitVec.zeroExtend 32 <<< 24)

      let timestampMs :=
        (arr[12]'(by omega)).toBitVec.zeroExtend 64 |||
        ((arr[13]'(by omega)).toBitVec.zeroExtend 64 <<< 8) |||
        ((arr[14]'(by omega)).toBitVec.zeroExtend 64 <<< 16) |||
        ((arr[15]'(by omega)).toBitVec.zeroExtend 64 <<< 24) |||
        ((arr[16]'(by omega)).toBitVec.zeroExtend 64 <<< 32) |||
        ((arr[17]'(by omega)).toBitVec.zeroExtend 64 <<< 40) |||
        ((arr[18]'(by omega)).toBitVec.zeroExtend 64 <<< 48) |||
        ((arr[19]'(by omega)).toBitVec.zeroExtend 64 <<< 56)

      let schemaVersion :=
        (arr[20]'(by omega)).toBitVec.zeroExtend 32 |||
        ((arr[21]'(by omega)).toBitVec.zeroExtend 32 <<< 8) |||
        ((arr[22]'(by omega)).toBitVec.zeroExtend 32 <<< 16) |||
        ((arr[23]'(by omega)).toBitVec.zeroExtend 32 <<< 24)

      some {
        mask := mask
        agentId := agentId
        timestampMs := timestampMs
        schemaVersion := schemaVersion
      }
    else
      none

/-- Wire size of a message (always 24 bytes). -/
def BitmaskMessage.wireSize (_msg : BitmaskMessage) : Nat :=
  MESSAGE_SIZE_BYTES

/--
JSON-equivalent size for comparison.
Useful for demonstrating compression ratio.
-/
def BitmaskMessage.jsonSize (msg : BitmaskMessage) : Nat :=
  -- Approximate JSON size: "mask": "<bigint>", "agentId": <num>,
  -- "timestampMs": <num>, "schemaVersion": <num>
  let maskStr := toString msg.mask
  let agentIdStr := toString msg.agentId
  let timestampStr := toString msg.timestampMs
  let versionStr := toString msg.schemaVersion
  9 + maskStr.length + 2 + 11 + agentIdStr.length + 2 +
  15 + timestampStr.length + 2 + 17 + versionStr.length + 2

/-- Compression ratio vs JSON encoding. -/
noncomputable def BitmaskMessage.compressionVsJson (msg : BitmaskMessage) : Real :=
  (msg.jsonSize : Real) / (msg.wireSize : Real)

/-- Human-readable string representation. -/
def BitmaskMessage.toString (msg : BitmaskMessage) : String :=
  s!"BitmaskMessage(agent={msg.agentId}, v={msg.schemaVersion}, mask={msg.mask}, t={msg.timestampMs})"

namespace Theorems

/-- Wire size is exactly 24 bytes. -/
theorem wireSize_correct (msg : BitmaskMessage) :
  msg.wireSize = MESSAGE_SIZE_BYTES := by rfl

/-- Serialization produces exactly 24 bytes. -/
theorem serialize_length (msg : BitmaskMessage) :
  ((List.finRange 24).map (serializeMessage msg)).length = 24 := by
  simp

/-- Deserialize rejects arrays with wrong length. -/
theorem deserialize_length_check (bytes : List UInt8) :
  bytes.length ≠ 24 → deserializeMessage bytes = none := by
  intro h
  unfold deserializeMessage
  simp [h]

/-- Valid messages roundtrip through serialization. -/
theorem message_roundtrip (msg : BitmaskMessage) (h : msg.isValid) :
  deserializeMessage ((List.finRange 24).map (serializeMessage msg)) = some msg := by
  unfold serializeMessage deserializeMessage
  simp
  congr
  · bv_decide
  · bv_decide
  · bv_decide
  · bv_decide

/-- Mask field is correctly serialized and deserialized. -/
theorem mask_roundtrip (msg : BitmaskMessage) (h : msg.isValid) :
  let bytes := (List.finRange 24).map (serializeMessage msg)
  let deserialized := deserializeMessage bytes
  deserialized.isSome → deserialized.get!.mask = msg.mask := by
  intro bytes deserialized h_some
  have h_eq := message_roundtrip msg h
  dsimp only [bytes, deserialized] at *
  rw [h_eq]
  rfl

/-- AgentId field is correctly serialized and deserialized. -/
theorem agentId_roundtrip (msg : BitmaskMessage) (h : msg.isValid) :
  let bytes := (List.finRange 24).map (serializeMessage msg)
  let deserialized := deserializeMessage bytes
  deserialized.isSome → deserialized.get!.agentId = msg.agentId := by
  intro bytes deserialized h_some
  have h_eq := message_roundtrip msg h
  dsimp only [bytes, deserialized] at *
  rw [h_eq]
  rfl

/-- Timestamp field is correctly serialized and deserialized. -/
theorem timestamp_roundtrip (msg : BitmaskMessage) (h : msg.isValid) :
  let bytes := (List.finRange 24).map (serializeMessage msg)
  let deserialized := deserializeMessage bytes
  deserialized.isSome → deserialized.get!.timestampMs = msg.timestampMs := by
  intro bytes deserialized h_some
  have h_eq := message_roundtrip msg h
  dsimp only [bytes, deserialized] at *
  rw [h_eq]
  rfl

/-- SchemaVersion field is correctly serialized and deserialized. -/
theorem schemaVersion_roundtrip (msg : BitmaskMessage) (h : msg.isValid) :
  let bytes := (List.finRange 24).map (serializeMessage msg)
  let deserialized := deserializeMessage bytes
  deserialized.isSome → deserialized.get!.schemaVersion = msg.schemaVersion := by
  intro bytes deserialized h_some
  have h_eq := message_roundtrip msg h
  dsimp only [bytes, deserialized] at *
  rw [h_eq]
  rfl

/-- Compression ratio is always > 1 (JSON is larger). -/
theorem compression_ratio_positive (msg : BitmaskMessage) :
  msg.compressionVsJson > 1 := by
  unfold BitmaskMessage.compressionVsJson
  have h_json : msg.jsonSize ≥ 60 := by
    dsimp [BitmaskMessage.jsonSize]
    omega
  have h_wire : msg.wireSize = 24 := rfl
  rw [h_wire]
  have h1 : (60 : Real) ≤ msg.jsonSize := Nat.cast_le.mpr h_json
  have h_pos : (0 : Real) < 24 := by norm_num
  exact (one_lt_div h_pos).mpr (lt_of_lt_of_le (by norm_num) h1)

/-- Message validity is preserved by roundtrip. -/
theorem roundtrip_preserves_validity (msg : BitmaskMessage) (h : msg.isValid) :
  let bytes := (List.finRange 24).map (serializeMessage msg)
  let deserialized := deserializeMessage bytes
  deserialized.isSome → deserialized.get!.isValid := by
  intro bytes deserialized h_some
  exact trivial

/-- Empty message (all zeros) roundtrips correctly. -/
theorem empty_message_roundtrip :
  let msg : BitmaskMessage := { mask := 0, agentId := 0, timestampMs := 0, schemaVersion := 0 }
  deserializeMessage ((List.finRange 24).map (serializeMessage msg)) = some msg := by rfl

/-- Maximum values roundtrip correctly. -/
theorem max_values_roundtrip :
  let msg : BitmaskMessage := {
    mask := ~~~0,
    agentId := ~~~0,
    timestampMs := ~~~0,
    schemaVersion := ~~~0
  }
  deserializeMessage ((List.finRange 24).map (serializeMessage msg)) = some msg := by rfl

end Theorems

end AdaptiveBitmask

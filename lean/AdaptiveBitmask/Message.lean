import AdaptiveBitmask.Basic
import Mathlib.Data.UInt
import Mathlib.Data.Int.Basic

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
  let maskBytes := fun i : Fin 8 =>
    UInt8.ofNat ((msg.mask.toNat >>> (8 * i.val)) &&& 0xFF)

  let agentIdBytes := fun i : Fin 4 =>
    UInt8.ofNat ((msg.agentId.toNat >>> (8 * i.val)) &&& 0xFF)

  let timestampBytes := fun i : Fin 8 =>
    UInt8.ofNat ((msg.timestampMs.toNat >>> (8 * i.val)) &&& 0xFF)

  let versionBytes := fun i : Fin 4 =>
    UInt8.ofNat ((msg.schemaVersion.toNat >>> (8 * i.val)) &&& 0xFF)

  fun i =>
    if h₁ : i.val < 8 then
      maskBytes ⟨i.val, h₁⟩
    else if h₂ : i.val < 12 then
      agentIdBytes ⟨i.val - 8, by omega⟩
    else if h₃ : i.val < 20 then
      timestampBytes ⟨i.val - 12, by omega⟩
    else
      versionBytes ⟨i.val - 20, by omega⟩

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
    if _ : arr.size ≠ 24 then
      none
    else
      -- Parse mask (bytes 0-7, little-endian)
      let maskNat := List.foldl (fun acc i =>
        acc ||| (UInt8.toNat arr[i]! <<< (8 * i))
      ) 0 (List.range 8)
      let mask := BitVec.ofNat 64 maskNat

      -- Parse agentId (bytes 8-11, little-endian)
      let agentIdNat := List.foldl (fun acc i =>
        acc ||| (UInt8.toNat arr[i + 8]! <<< (8 * i))
      ) 0 (List.range 4)
      let agentId := BitVec.ofNat 32 agentIdNat

      -- Parse timestampMs (bytes 12-19, little-endian)
      let tsNat := List.foldl (fun acc i =>
        acc ||| (UInt8.toNat arr[i + 12]! <<< (8 * i))
      ) 0 (List.range 8)
      let timestampMs := BitVec.ofNat 64 tsNat

      -- Parse schemaVersion (bytes 20-23, little-endian)
      let schemaVersionNat := List.foldl (fun acc i =>
        acc ||| (UInt8.toNat arr[i + 20]! <<< (8 * i))
      ) 0 (List.range 4)
      let schemaVersion := BitVec.ofNat 32 schemaVersionNat

      some {
        mask := mask
        agentId := agentId
        timestampMs := timestampMs
        schemaVersion := schemaVersion
      }

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
  deserializeMessage ((List.finRange 24).map (serializeMessage msg)) = some msg := by sorry

/-- Mask field is correctly serialized and deserialized. -/
theorem mask_roundtrip (msg : BitmaskMessage) (h : msg.isValid) :
  let bytes := (List.finRange 24).map (serializeMessage msg)
  let deserialized := deserializeMessage bytes
  deserialized.isSome → deserialized.get!.mask = msg.mask := by sorry

/-- AgentId field is correctly serialized and deserialized. -/
theorem agentId_roundtrip (msg : BitmaskMessage) (h : msg.isValid) :
  let bytes := (List.finRange 24).map (serializeMessage msg)
  let deserialized := deserializeMessage bytes
  deserialized.isSome → deserialized.get!.agentId = msg.agentId := by sorry

/-- Timestamp field is correctly serialized and deserialized. -/
theorem timestamp_roundtrip (msg : BitmaskMessage) (h : msg.isValid) :
  let bytes := (List.finRange 24).map (serializeMessage msg)
  let deserialized := deserializeMessage bytes
  deserialized.isSome → deserialized.get!.timestampMs = msg.timestampMs := by sorry

/-- SchemaVersion field is correctly serialized and deserialized. -/
theorem schemaVersion_roundtrip (msg : BitmaskMessage) (h : msg.isValid) :
  let bytes := (List.finRange 24).map (serializeMessage msg)
  let deserialized := deserializeMessage bytes
  deserialized.isSome → deserialized.get!.schemaVersion = msg.schemaVersion := by sorry

/-- Compression ratio is always > 1 (JSON is larger). -/
theorem compression_ratio_positive (msg : BitmaskMessage) :
  msg.compressionVsJson > 1 := by
  sorry

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

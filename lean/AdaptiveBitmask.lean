-- Adaptive Bitmask Protocol Formal Verification
-- 
-- This library formalizes the mathematical foundations of the
-- adaptive-bitmask coordination protocol for multi-agent systems.
--
-- Structure:
--   - Basic:       Core 64-bit bitmask operations
--   - Schema:      Feature-to-bit mapping and collision theory
--   - Message:     24-byte wire format serialization
--   - Coordinator: Multi-agent aggregation logic
--   - Arbiter:     Weighted scoring and decision synthesis

import AdaptiveBitmask.Basic
import AdaptiveBitmask.Schema
import AdaptiveBitmask.Message
import AdaptiveBitmask.Coordinator
import AdaptiveBitmask.Arbiter

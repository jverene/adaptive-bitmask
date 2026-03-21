import Lake
open Lake DSL

package adaptive_bitmask

require mathlib from git
  "https://github.com/leanprover-community/mathlib4.git"

@[default_target]
lean_lib AdaptiveBitmask

lean_lib AdaptiveBitmaskTests

@[test_driver]
lean_exe test where
  srcDir := "."
  root := `AdaptiveBitmaskTests

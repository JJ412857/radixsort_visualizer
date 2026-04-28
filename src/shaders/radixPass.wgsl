const WORKGROUP_SIZE: u32 = 256u;

// Shared parameters from CPU.
// bit = current radix bit being processed.
struct Params {
  count: u32,
  maxValue: u32,
  bit: u32,
  pad: u32,
};

// Input buffer for the current pass.
@group(0) @binding(0)
var<storage, read> inputValues: array<u32>;

// Output buffer for the reordered result.
@group(0) @binding(1)
var<storage, read_write> outputValues: array<u32>;

// Uniform parameters.
@group(0) @binding(2)
var<uniform> params: Params;

// Workgroup shared memory for prefix sums.
var<workgroup> zeroScan: array<u32, 256>;
var<workgroup> oneScan: array<u32, 256>;
var<workgroup> totalZeros: u32;

@compute @workgroup_size(256)
fn csMain(@builtin(local_invocation_id) localId: vec3<u32>) {
  let i = localId.x;

  var value = 0u;
  var bitValue = 0u;

  // -----------------------------
  // 1. Classify each value
  // -----------------------------
  // zeroScan[i] starts as 1 if current bit is 0.
  // oneScan[i] starts as 1 if current bit is 1.
  if (i < params.count) {
    value = inputValues[i];
    bitValue = (value >> params.bit) & 1u;

    zeroScan[i] = select(1u, 0u, bitValue == 1u);
    oneScan[i] = bitValue;
  } else {
    zeroScan[i] = 0u;
    oneScan[i] = 0u;
  }

  workgroupBarrier();

  // -----------------------------
  // 2. Up-sweep / reduce phase
  // -----------------------------
  // Builds a reduction tree in shared memory.
  // After this, zeroScan[WORKGROUP_SIZE - 1] stores total zero count.
  var offset = 1u;

  for (var d = WORKGROUP_SIZE >> 1u; d > 0u; d = d >> 1u) {
    if (i < d) {
      let ai = offset * (2u * i + 1u) - 1u;
      let bi = offset * (2u * i + 2u) - 1u;

      zeroScan[bi] = zeroScan[bi] + zeroScan[ai];
      oneScan[bi] = oneScan[bi] + oneScan[ai];
    }

    offset = offset << 1u;
    workgroupBarrier();
  }

  // -----------------------------
  // 3. Prepare exclusive scan
  // -----------------------------
  // Save total number of zero-bit elements.
  // Then set the tree root to 0 to convert the scan into exclusive scan.
  if (i == 0u) {
    totalZeros = zeroScan[WORKGROUP_SIZE - 1u];

    zeroScan[WORKGROUP_SIZE - 1u] = 0u;
    oneScan[WORKGROUP_SIZE - 1u] = 0u;
  }

  workgroupBarrier();

  // -----------------------------
  // 4. Down-sweep phase
  // -----------------------------
  // Converts the reduction tree into exclusive prefix sums.
  // After this:
  //   zeroScan[i] = number of zero-bit elements before i
  //   oneScan[i]  = number of one-bit elements before i
  for (var d = 1u; d < WORKGROUP_SIZE; d = d << 1u) {
    offset = offset >> 1u;

    if (i < d) {
      let ai = offset * (2u * i + 1u) - 1u;
      let bi = offset * (2u * i + 2u) - 1u;

      let zeroTemp = zeroScan[ai];
      zeroScan[ai] = zeroScan[bi];
      zeroScan[bi] = zeroScan[bi] + zeroTemp;

      let oneTemp = oneScan[ai];
      oneScan[ai] = oneScan[bi];
      oneScan[bi] = oneScan[bi] + oneTemp;
    }

    workgroupBarrier();
  }

  if (i >= params.count) {
    return;
  }

  // -----------------------------
  // 5. Scatter
  // -----------------------------
  // If bit is 0:
  //   place in the zero bucket using zeroScan[i].
  // If bit is 1:
  //   place after all zeros, offset by oneScan[i].
  var newIndex: u32;

  if (bitValue == 0u) {
    newIndex = zeroScan[i];
  } else {
    newIndex = totalZeros + oneScan[i];
  }

  outputValues[newIndex] = value;
}
const WORKGROUP_SIZE: u32 = 256u;

struct Params {
  count: u32,
  maxValue: u32,
  bit: u32,
  pad: u32,
};

@group(0) @binding(0)
var<storage, read> inputValues: array<u32>;

@group(0) @binding(1)
var<storage, read_write> outputValues: array<u32>;

@group(0) @binding(2)
var<uniform> params: Params;

var<workgroup> zeroScan: array<u32, 256>;
var<workgroup> oneScan: array<u32, 256>;
var<workgroup> totalZeros: u32;

@compute @workgroup_size(256)
fn csMain(@builtin(local_invocation_id) localId: vec3<u32>) {
  let i = localId.x;

  var value = 0u;
  var bitValue = 0u;

  if (i < params.count) {
    value = inputValues[i];
    bitValue = (value >> params.bit) & 1u;

    if (bitValue == 0u) {
      zeroScan[i] = 1u;
      oneScan[i] = 0u;
    } else {
      zeroScan[i] = 0u;
      oneScan[i] = 1u;
    }
  } else {
    zeroScan[i] = 0u;
    oneScan[i] = 0u;
  }

  workgroupBarrier();

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

  if (i == 0u) {
    totalZeros = zeroScan[WORKGROUP_SIZE - 1u];

    zeroScan[WORKGROUP_SIZE - 1u] = 0u;
    oneScan[WORKGROUP_SIZE - 1u] = 0u;
  }

  workgroupBarrier();

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

  var newIndex: u32;

  if (bitValue == 0u) {
    newIndex = zeroScan[i];
  } else {
    newIndex = totalZeros + oneScan[i];
  }

  outputValues[newIndex] = value;
}
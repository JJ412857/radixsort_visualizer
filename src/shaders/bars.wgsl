struct Params {
    count: u32,
    maxValue: u32,
    bit: u32,
    pad: u32,
};

struct VertexOutput {
    @builtin(position) position: vec4<f32>,
    @location(0) bitValue: f32,
};

@group(0) @binding(0)
var<storage, read> values: array<u32>;

@group(0) @binding(1)
var<uniform> params: Params;

@vertex
fn vsMain(
    @builtin(vertex_index) vertex_index: u32,
    @builtin(instance_index) instance_index: u32,
) -> VertexOutput {
    let value = f32(values[instance_index]);

    let count = f32(params.count);
    let maxValue = f32(params.maxValue);

    let barWidth = 2.0 / count;
    let gap = barWidth * 0.08;

    let left = -1.0 + f32(instance_index) * barWidth + gap * 0.5;
    let right = -1.0 + f32(instance_index + 1u) * barWidth - gap * 0.5;

    let bottom = -1.0;
    let normalized = value / maxValue;
    let top = -1.0 + normalized * 2.0;

    var x: f32;
    var y: f32;

    if (vertex_index == 0u) {
        x = left;
        y = bottom;
    } else if (vertex_index == 1u) {
        x = right;
        y = bottom;
    } else if (vertex_index == 2u) {
        x = right;
        y = top;
    } else if (vertex_index == 3u) {
        x = left;
        y = bottom;
    } else if (vertex_index == 4u) {
        x = right;
        y = top;
    } else {
        x = left;
        y = top;
    }

    let rawValue = values[instance_index];
    let currentBit = (rawValue >> params.bit) & 1u;

    var out: VertexOutput;
    out.position = vec4<f32>(x, y, 0.0, 1.0);
    out.bitValue = f32(currentBit);
    return out;
}

@fragment
fn fsMain(
    @location(0) bitValue: f32
) -> @location(0) vec4<f32> {
    if (bitValue < 0.5) {
        return vec4<f32>(0.2, 0.6, 0.9, 1.0);
    } else {
        return vec4<f32>(0.9, 0.3, 0.3, 1.0);
    }
}
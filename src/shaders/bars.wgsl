struct Params {
    count: u32,
    maxValue: u32,
    bit: u32,
    pad: u32,
};

// Data passed from vertex shader to fragment shader.
struct VertexOutput {
    @builtin(position) position: vec4<f32>,
    @location(0) bitValue: f32,
};

// Current values to render as bars.
@group(0) @binding(0)
var<storage, read> values: array<u32>;

// Shared render/sort parameters.
@group(0) @binding(1)
var<uniform> params: Params;

@vertex
fn vsMain(
    @builtin(vertex_index) vertexIndex: u32,
    @builtin(instance_index) instanceIndex: u32,
) -> VertexOutput {
    // Each instance is one bar.
    let rawValue = values[instanceIndex];
    let value = f32(rawValue);

    let count = f32(params.count);
    let maxValue = f32(params.maxValue);

    // Compute horizontal bar bounds in clip space [-1, 1].
    let barWidth = 2.0 / count;
    let gap = barWidth * 0.08;

    let left = -1.0 + f32(instanceIndex) * barWidth + gap * 0.5;
    let right = -1.0 + f32(instanceIndex + 1u) * barWidth - gap * 0.5;

    // Compute vertical bar height in clip space [-1, 1].
    let bottom = -1.0;
    let normalized = value / maxValue;
    let top = -1.0 + normalized * 2.0;

    // One bar = two triangles = six vertices.
    var x: f32;
    var y: f32;

    if (vertexIndex == 0u) {
        x = left;
        y = bottom;
    } else if (vertexIndex == 1u) {
        x = right;
        y = bottom;
    } else if (vertexIndex == 2u) {
        x = right;
        y = top;
    } else if (vertexIndex == 3u) {
        x = left;
        y = bottom;
    } else if (vertexIndex == 4u) {
        x = right;
        y = top;
    } else {
        x = left;
        y = top;
    }

    // Color is based on the current radix bit.
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
    // bit 0 -> blue, bit 1 -> red
    if (bitValue < 0.5) {
        return vec4<f32>(0.2, 0.6, 0.9, 1.0);
    }

    return vec4<f32>(0.9, 0.3, 0.3, 1.0);
}
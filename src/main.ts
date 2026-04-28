import barsShader from "./shaders/bars.wgsl";
import radixShader from "./shaders/radixPass.wgsl";

async function main() {
    // =========================
    // 1. Canvas + WebGPU setup
    // =========================
    const canvas = document.getElementById("gpu-canvas") as HTMLCanvasElement | null;
    if (!canvas) {
        throw new Error("Canvas not found");
    }

    if (!navigator.gpu) {
        throw new Error("WebGPU not supported in this browser");
    }

    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) {
        throw new Error("Failed to get GPU adapter");
    }

    const device = await adapter.requestDevice();

    const context = canvas.getContext("webgpu");
    if (!context) {
        throw new Error("Failed to get WebGPU canvas context");
    }

    const gpuContext = context as GPUCanvasContext;
    const format = navigator.gpu.getPreferredCanvasFormat();

    gpuContext.configure({
        device,
        format,
        alphaMode: "opaque",
    });

    // =========================
    // 2. UI elements
    // =========================
    const playBtn = document.getElementById("play-btn") as HTMLButtonElement | null;
    const stopBtn = document.getElementById("stop-btn") as HTMLButtonElement | null;
    const stepBtn = document.getElementById("step-btn") as HTMLButtonElement | null;
    const resetBtn = document.getElementById("reset-btn") as HTMLButtonElement | null;
    const status = document.getElementById("status") as HTMLSpanElement;

    if (!playBtn || !stopBtn || !stepBtn || !resetBtn || !status) {
        throw new Error("UI element not found");
    }

    // =========================
    // 3. Data settings
    // =========================
    const MAX_COUNT = 256;

    let count = 64;
    let maxValue = 100;
    let currentBit = 0;
    const maxBits = Math.floor(Math.log2(maxValue)) + 1;

    function generateRandomValues(count: number, maxValue: number): Uint32Array {
        const values = new Uint32Array(count);

        for (let i = 0; i < count; i++) {
            values[i] = Math.floor(Math.random() * maxValue) + 1;
        }

        return values;
    }

    let currentValues = generateRandomValues(count, maxValue);
    const originalValues = new Uint32Array(currentValues);

    // =========================
    // 4. GPU buffers
    // =========================
    const valuesBufferA = device.createBuffer({
        size: MAX_COUNT * 4,
        usage:
            GPUBufferUsage.STORAGE |
            GPUBufferUsage.COPY_DST |
            GPUBufferUsage.COPY_SRC,
    });

    const valuesBufferB = device.createBuffer({
        size: MAX_COUNT * 4,
        usage:
            GPUBufferUsage.STORAGE |
            GPUBufferUsage.COPY_DST |
            GPUBufferUsage.COPY_SRC,
    });

    const paramsBuffer = device.createBuffer({
        size: 4 * 4,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    device.queue.writeBuffer(valuesBufferA, 0, currentValues);

    // Ping-pong buffers:
    // inputBuffer = current readable data
    // outputBuffer = compute shader writes next pass result here
    let inputBuffer = valuesBufferA;
    let outputBuffer = valuesBufferB;

    function updateParams() {
        const params = new Uint32Array([
            count,
            maxValue,
            currentBit,
            0, // padding
        ]);

        device.queue.writeBuffer(paramsBuffer, 0, params);
    }

    // =========================
    // 5. Shader modules
    // =========================
    const renderShaderModule = device.createShaderModule({
        code: barsShader,
    });

    const computeShaderModule = device.createShaderModule({
        code: radixShader,
    });

    // =========================
    // 6. Render pipeline
    // =========================
    const renderPipeline = device.createRenderPipeline({
        layout: "auto",
        vertex: {
            module: renderShaderModule,
            entryPoint: "vsMain",
        },
        fragment: {
            module: renderShaderModule,
            entryPoint: "fsMain",
            targets: [{ format }],
        },
        primitive: {
            topology: "triangle-list",
        },
    });

    function createRenderBindGroup(valuesBuffer: GPUBuffer) {
        return device.createBindGroup({
            layout: renderPipeline.getBindGroupLayout(0),
            entries: [
                {
                    binding: 0,
                    resource: { buffer: valuesBuffer },
                },
                {
                    binding: 1,
                    resource: { buffer: paramsBuffer },
                },
            ],
        });
    }

    function draw(valuesBuffer: GPUBuffer) {
        const renderBindGroup = createRenderBindGroup(valuesBuffer);

        const commandEncoder = device.createCommandEncoder();
        const textureView = gpuContext.getCurrentTexture().createView();

        const renderPass = commandEncoder.beginRenderPass({
            colorAttachments: [
                {
                    view: textureView,
                    clearValue: { r: 1, g: 1, b: 1, a: 1 },
                    loadOp: "clear",
                    storeOp: "store",
                },
            ],
        });

        renderPass.setPipeline(renderPipeline);
        renderPass.setBindGroup(0, renderBindGroup);
        renderPass.draw(6, count); // 6 vertices per bar, count bars
        renderPass.end();

        device.queue.submit([commandEncoder.finish()]);
    }

    // =========================
    // 7. Compute pipeline
    // =========================
    const computePipeline = device.createComputePipeline({
        layout: "auto",
        compute: {
            module: computeShaderModule,
            entryPoint: "csMain",
        },
    });

    function createComputeBindGroup(input: GPUBuffer, output: GPUBuffer) {
        return device.createBindGroup({
            layout: computePipeline.getBindGroupLayout(0),
            entries: [
                {
                    binding: 0,
                    resource: { buffer: input },
                },
                {
                    binding: 1,
                    resource: { buffer: output },
                },
                {
                    binding: 2,
                    resource: { buffer: paramsBuffer },
                },
            ],
        });
    }

    function gpuRadixStep() {
        if (currentBit >= maxBits) {
            console.log("Sorting done");
            return;
        }

        // Send current bit/count/maxValue to GPU.
        updateParams();

        const computeBindGroup = createComputeBindGroup(inputBuffer, outputBuffer);

        const commandEncoder = device.createCommandEncoder();

        const computePass = commandEncoder.beginComputePass();
        computePass.setPipeline(computePipeline);
        computePass.setBindGroup(0, computeBindGroup);
        computePass.dispatchWorkgroups(1); // single workgroup version, count <= 256
        computePass.end();

        device.queue.submit([commandEncoder.finish()]);

        // Swap buffers after one radix pass.
        const temp = inputBuffer;
        inputBuffer = outputBuffer;
        outputBuffer = temp;

        currentBit += 1;

        draw(inputBuffer);
    }

    // =========================
    // 8. UI helpers
    // =========================
    function updateStatus() {
        status.textContent =
            currentBit >= maxBits ? "Done" : `Bit: ${currentBit}`;
    }

    let timer: number | null = null;

    function play() {
        if (timer !== null) return;

        timer = window.setInterval(() => {
            if (currentBit >= maxBits) {
                stop();
                return;
            }

            gpuRadixStep();
            updateStatus();
        }, 500);
    }

    function stop() {
        if (timer !== null) {
            clearInterval(timer);
            timer = null;
        }
    }

    function reset() {
        stop();

        device.queue.writeBuffer(valuesBufferA, 0, originalValues);

        inputBuffer = valuesBufferA;
        outputBuffer = valuesBufferB;
        currentBit = 0;

        updateParams();
        draw(inputBuffer);
        updateStatus();
    }

    // =========================
    // 9. Event listeners
    // =========================
    playBtn.addEventListener("click", play);
    stopBtn.addEventListener("click", stop);

    stepBtn.addEventListener("click", () => {
        gpuRadixStep();
        updateStatus();
    });

    resetBtn.addEventListener("click", reset);

    // =========================
    // 10. Initial render
    // =========================
    updateParams();
    draw(inputBuffer);
    updateStatus();
}

main().catch((err) => {
    console.error(err);
});
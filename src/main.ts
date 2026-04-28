import barsShader from "./shaders/bars.wgsl";
import radixShader from "./shaders/radixPass.wgsl";

async function main() {
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
    const playBtn = document.getElementById("play-btn") as HTMLButtonElement | null;
    const stopBtn = document.getElementById("stop-btn") as HTMLButtonElement | null;

    if (!playBtn || !stopBtn) {
        throw new Error("Play/Stop button not found");
    }

    const stepBtn = document.getElementById("step-btn") as HTMLButtonElement | null;
    const status = document.getElementById("status") as HTMLSpanElement;

    if (!stepBtn || !status) {
        throw new Error("UI element not found");
    }

    const resetBtn = document.getElementById("reset-btn") as HTMLButtonElement | null;

    if (!resetBtn) {
        throw new Error("Reset button not found");
    }

    const shaderModule = device.createShaderModule({
        code: barsShader,
    });

    let count = 64;
    let maxValue = 100;
    let currentBit = 0;
    function generateRandomValues(count: number, maxValue: number): Uint32Array {
        const values = new Uint32Array(count);

        for (let i = 0; i < count; i++) {
            values[i] = Math.floor(Math.random() * maxValue) + 1;
        }

        return values;
    }
    const maxBits = Math.floor(Math.log2(maxValue)) + 1;

    const MAX_COUNT = 256;

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

    let currentValues = generateRandomValues(count, maxValue);
    let originalValues = new Uint32Array(currentValues);

    device.queue.writeBuffer(valuesBufferA, 0, currentValues);

    let inputBuffer = valuesBufferA;
    let outputBuffer = valuesBufferB;

    const paramsBuffer = device.createBuffer({
        size: 4 * 4,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    function updateParams() {
        const params = new Uint32Array([
            count,
            maxValue,
            currentBit,
            0,
        ]);

        device.queue.writeBuffer(paramsBuffer, 0, params);
    }

    const computeShaderModule = device.createShaderModule({
        code: radixShader,
    });

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

        updateParams();

        const computeBindGroup = createComputeBindGroup(inputBuffer, outputBuffer);

        const commandEncoder = device.createCommandEncoder();

        const computePass = commandEncoder.beginComputePass();
        computePass.setPipeline(computePipeline);
        computePass.setBindGroup(0, computeBindGroup);
        computePass.dispatchWorkgroups(1);
        computePass.end();

        device.queue.submit([commandEncoder.finish()]);

        const temp = inputBuffer;
        inputBuffer = outputBuffer;
        outputBuffer = temp;

        currentBit += 1;

        draw(inputBuffer);
    }

    const renderPipeline = device.createRenderPipeline({
        layout: "auto",
        vertex: {
            module: shaderModule,
            entryPoint: "vsMain",
        },
        fragment: {
            module: shaderModule,
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
        renderPass.draw(6, count);
        renderPass.end();

        device.queue.submit([commandEncoder.finish()]);
    }
    function updateStatus() {
        status.textContent = currentBit >= maxBits
            ? "Done"
            : `Bit: ${currentBit}`;
    }


    playBtn.addEventListener("click", play);
    stopBtn.addEventListener("click", stop);
    stepBtn.addEventListener("click", () => {
        gpuRadixStep();
        updateStatus();
    });
    resetBtn.addEventListener("click", () => {
        device.queue.writeBuffer(valuesBufferA, 0, originalValues);

        inputBuffer = valuesBufferA;
        outputBuffer = valuesBufferB;

        currentBit = 0;

        updateParams();
        draw(inputBuffer);
        updateStatus();
    });



    updateParams();
    draw(inputBuffer);
    updateStatus();
}

main().catch((err) => {
    console.error(err);
});
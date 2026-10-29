// Audio worklet that hands mic audio to the main thread in batches, tagged
// with the AudioContext frame of the first sample so takes line up exactly
// with scheduled playback.
const BATCH = 4096;

class CaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buffer = new Float32Array(BATCH);
    this.filled = 0;
    this.startFrame = 0;
    this.port.onmessage = (e) => {
      if (e.data === 'flush') {
        this.flush();
        this.port.postMessage({ flushed: true });
      }
    };
  }

  flush() {
    if (this.filled === 0) return;
    this.port.postMessage({ frame: this.startFrame, samples: this.buffer.slice(0, this.filled) });
    this.filled = 0;
  }

  process(inputs) {
    const channels = inputs[0];
    if (!channels || channels.length === 0) return true;
    const n = channels[0].length;
    for (let i = 0; i < n; i++) {
      if (this.filled === 0) this.startFrame = currentFrame + i;
      let sum = 0;
      for (const ch of channels) sum += ch[i];
      this.buffer[this.filled++] = sum / channels.length;
      if (this.filled === BATCH) this.flush();
    }
    return true;
  }
}

registerProcessor('hummagroove-capture', CaptureProcessor);

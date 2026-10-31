// Reads the length of a recording from the container headers, so the file never has to be fully
// downloaded. The billed estimate mirrors how Speech-to-Text bills: rounded up to 15 s, and per
// channel when each channel is recognised separately (which GoogleSpeech does for multichannel Opus).
const AudioDuration = {
  BILLING_STEP_SECONDS: 15,

  // Little-endian unsigned integer; fine up to 2^53.
  uint_(bytes, offset, length) {
    let value = 0;
    for (let i = length - 1; i >= 0; i--) value = value * 256 + ((bytes[offset + i] || 0) & 0xff);
    return value;
  },

  matches_(bytes, offset, text) {
    for (let i = 0; i < text.length; i++) {
      if (((bytes[offset + i] || 0) & 0xff) !== text.charCodeAt(i)) return false;
    }
    return true;
  },

  // head: first bytes of the file (OpusHead), tail: last bytes (last Ogg page holds the end position).
  opus(head, tail) {
    let preSkip = null;
    let channels = 0;
    for (let i = 0; i + 12 <= Math.min(head.length, 256); i++) {
      if (AudioDuration.matches_(head, i, 'OpusHead')) {
        channels = head[i + 9] & 0xff;
        preSkip = AudioDuration.uint_(head, i + 10, 2);
        break;
      }
    }
    if (preSkip === null) return null;
    for (let i = tail.length - 14; i >= 0; i--) {
      if (!AudioDuration.matches_(tail, i, 'OggS') || (tail[i + 4] & 0xff) !== 0) continue;
      if (AudioDuration.uint_(tail, i + 10, 4) === 0xffffffff) return null;
      const granule = AudioDuration.uint_(tail, i + 6, 8);
      if (granule < preSkip) return null;
      return { durationSeconds: (granule - preSkip) / 48000, channels };
    }
    return null;
  },

  wav(head, fileSize) {
    if (!AudioDuration.matches_(head, 0, 'RIFF') || !AudioDuration.matches_(head, 8, 'WAVE')) return null;
    let byteRate = 0;
    let channels = 0;
    let offset = 12;
    while (offset + 8 <= head.length) {
      const size = AudioDuration.uint_(head, offset + 4, 4);
      if (AudioDuration.matches_(head, offset, 'fmt ')) {
        channels = AudioDuration.uint_(head, offset + 10, 2);
        byteRate = AudioDuration.uint_(head, offset + 16, 4);
      } else if (AudioDuration.matches_(head, offset, 'data')) {
        const available = fileSize - (offset + 8);
        const dataSize = size === 0 || size === 0xffffffff || size > available ? available : size;
        if (!byteRate || dataSize <= 0) return null;
        return { durationSeconds: dataSize / byteRate, channels };
      }
      offset += 8 + size + (size % 2);
    }
    return null;
  },

  flac(head) {
    if (!AudioDuration.matches_(head, 0, 'fLaC') || head.length < 26) return null;
    const b = (i) => head[i] & 0xff;
    const sampleRate = (b(18) << 12) | (b(19) << 4) | (b(20) >> 4);
    const channels = ((b(20) >> 1) & 7) + 1;
    const totalSamples = (b(21) & 0x0f) * 4294967296 + AudioDuration.uint_([b(25), b(24), b(23), b(22)], 0, 4);
    if (!sampleRate || !totalSamples) return null;
    return { durationSeconds: totalSamples / sampleRate, channels };
  },

  billedEstimate(durationSeconds, billedChannels) {
    const step = AudioDuration.BILLING_STEP_SECONDS;
    return billedChannels * Math.max(step, Math.ceil(durationSeconds / step) * step);
  },

  // Returns {durationSeconds, billedSeconds} or null when the length cannot be read.
  estimate(fileName, head, tail, fileSize) {
    const logic = typeof Logic !== 'undefined' ? Logic : require('./Logic.js');
    const encoding = logic.encodingFor(fileName);
    let info = null;
    let billedChannels = 1;
    if (encoding === 'OGG_OPUS') {
      info = AudioDuration.opus(head, tail);
      if (info && info.channels > 1) billedChannels = info.channels;
    } else if (encoding === 'LINEAR16') {
      info = AudioDuration.wav(head, fileSize);
    } else if (encoding === 'FLAC') {
      info = AudioDuration.flac(head);
    }
    if (!info || !(info.durationSeconds > 0)) return null;
    return {
      durationSeconds: info.durationSeconds,
      billedSeconds: AudioDuration.billedEstimate(info.durationSeconds, billedChannels),
    };
  },
};

if (typeof module !== 'undefined') module.exports = AudioDuration;

const Providers = {
  get(id) {
    if (id === 'google-speech') return googleSpeechProvider_();
    if (id === 'groq') return groqProvider_();
    if (id === 'deepgram') return deepgramProvider_();
    throw new Error('Unknown provider: ' + id);
  },

  list() {
    return [
      { id: 'google-speech', name: 'Google Cloud Speech-to-Text' },
      { id: 'groq', name: 'Groq (Whisper)' },
      { id: 'deepgram', name: 'Deepgram' },
    ];
  },
};

import AVFoundation
import Speech

@MainActor
final class AudioService: NSObject, ObservableObject, @preconcurrency AVSpeechSynthesizerDelegate {
    @Published var isSpeaking = false
    @Published var transcript = ""
    private let synthesizer = AVSpeechSynthesizer()
    private let engine = AVAudioEngine()
    private var recognitionTask: SFSpeechRecognitionTask?

    override init() { super.init(); synthesizer.delegate = self }

    func speak(_ text: String, rate: Float = AVSpeechUtteranceDefaultSpeechRate) {
        guard !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return }
        do {
            let session = AVAudioSession.sharedInstance()
            try session.setCategory(.playback, mode: .spokenAudio, options: [.duckOthers])
            try session.setActive(true)
        } catch {
            print("[WordHint] Audio session activation failed: \(error.localizedDescription)")
        }
        if synthesizer.isSpeaking { synthesizer.stopSpeaking(at: .immediate) }
        let utterance = AVSpeechUtterance(string: text)
        utterance.voice = AVSpeechSynthesisVoice(language: "en-US") ?? AVSpeechSynthesisVoice(language: "en-GB")
        utterance.rate = rate
        utterance.volume = 1
        synthesizer.speak(utterance); isSpeaking = true
    }
    func stop() { synthesizer.stopSpeaking(at: .immediate); isSpeaking = false }
    func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didFinish utterance: AVSpeechUtterance) { isSpeaking = false }

    func requestPermissions() async -> Bool {
        let speech = await withCheckedContinuation { continuation in SFSpeechRecognizer.requestAuthorization { continuation.resume(returning: $0 == .authorized) } }
        let microphone = await AVAudioApplication.requestRecordPermission()
        return speech && microphone
    }

    func startRecognition() throws {
        recognitionTask?.cancel(); transcript = ""
        let request = SFSpeechAudioBufferRecognitionRequest(); request.shouldReportPartialResults = true
        let input = engine.inputNode; let format = input.outputFormat(forBus: 0)
        input.removeTap(onBus: 0)
        input.installTap(onBus: 0, bufferSize: 1024, format: format) { buffer, _ in request.append(buffer) }
        engine.prepare(); try engine.start()
        recognitionTask = SFSpeechRecognizer(locale: Locale(identifier: "en-US"))?.recognitionTask(with: request) { [weak self] result, _ in
            Task { @MainActor in self?.transcript = result?.bestTranscription.formattedString ?? self?.transcript ?? "" }
        }
    }
    func stopRecognition() { engine.stop(); engine.inputNode.removeTap(onBus: 0); recognitionTask?.finish() }
}

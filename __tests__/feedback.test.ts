import { feedbackError, feedbackSuccess, prepareFeedbackAudio } from "@/client/feedback";

it("reuses the unlocked audio context and distinguishes success from failure", () => {
  const oscillators: Array<{ frequency: { value: number }; type: string; start: jest.Mock; stop: jest.Mock }> = [];
  const resume = jest.fn().mockResolvedValue(undefined);
  const AudioContext = jest.fn().mockImplementation(() => ({
    state: "suspended",
    resume,
    currentTime: 5,
    destination: {},
    createOscillator: () => {
      const oscillator = { frequency: { value: 0 }, type: "", start: jest.fn(), stop: jest.fn(), connect: jest.fn((destination: unknown) => destination), disconnect: jest.fn() };
      oscillators.push(oscillator);
      return oscillator;
    },
    createGain: () => ({
      gain: { setValueAtTime: jest.fn(), exponentialRampToValueAtTime: jest.fn() },
      connect: jest.fn(), disconnect: jest.fn(),
    }),
  }));
  Object.defineProperty(globalThis, "window", { configurable: true, value: { AudioContext } });
  try {
    prepareFeedbackAudio();
    expect(oscillators).toHaveLength(0); // Unlocking while typing stays silent.
    feedbackSuccess();
    expect(oscillators.map((oscillator) => oscillator.frequency.value)).toEqual([1000]);
    feedbackError();
    expect(oscillators.map((oscillator) => oscillator.frequency.value)).toEqual([1000, 220, 180]);
    expect(oscillators[2].start).toHaveBeenCalledWith(5.2);
    expect(AudioContext).toHaveBeenCalledTimes(1);
    expect(resume).toHaveBeenCalled();
  } finally {
    Reflect.deleteProperty(globalThis, "window");
  }
});

it("unsupported audio never interrupts scanning", () => {
  expect(() => { prepareFeedbackAudio(); feedbackSuccess(); feedbackError(); }).not.toThrow();
});

/**
 * AcuDx — bedside monitor barrel.
 * Live vitals monitor, trend monitor, and the pure waveform helpers.
 */

export { LiveVitalsMonitor, type LiveVitalsMonitorProps } from "./LiveVitalsMonitor";
export { TrendMonitor, type TrendMonitorProps } from "./TrendMonitor";
export {
  ecgPath,
  plethPath,
  arterialPath,
  respirationPath,
  flatlinePath,
  ecgShape,
  plethShape,
  respShape,
  hrToHz,
  rrToHz,
  spo2ToAmplitude,
  type WaveformSpec,
} from "./waveforms";

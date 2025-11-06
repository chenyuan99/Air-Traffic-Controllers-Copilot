import { IService } from './IService';
import { Aircraft, WeatherData, RadioTransmission } from '../types';

export interface IRadarDataProcessor extends IService {
  processRadarData(rawData: Buffer): Promise<Aircraft[]>;
  getAircraftPositions(): Promise<Aircraft[]>;
  subscribeToRadarUpdates(callback: (aircraft: Aircraft[]) => void): void;
}

export interface IRadioInterface extends IService {
  startListening(frequency: string): Promise<void>;
  stopListening(frequency: string): Promise<void>;
  onTransmission(callback: (transmission: RadioTransmission) => void): void;
  getActiveFrequencies(): string[];
}

export interface IWeatherService extends IService {
  getCurrentWeather(): Promise<WeatherData>;
  getWeatherForecast(hours: number): Promise<WeatherData[]>;
  subscribeToWeatherUpdates(callback: (weather: WeatherData) => void): void;
  analyzeWeatherImpact(weather: WeatherData): Promise<{
    runwayRecommendations: string[];
    operationalImpacts: string[];
  }>;
}
import { IService } from './IService';
import { Aircraft, FlightStrip, RadioTransmission, Alert, Conflict } from '../types';

export interface ITimeSeriesDatabase extends IService {
  writeAircraftPosition(aircraft: Aircraft): Promise<void>;
  writeAircraftPositions(aircraft: Aircraft[]): Promise<void>;
  queryAircraftHistory(
    callsign: string, 
    startTime: Date, 
    endTime: Date
  ): Promise<Aircraft[]>;
  
  queryAircraftInArea(
    bounds: {
      minLat: number;
      maxLat: number;
      minLon: number;
      maxLon: number;
    },
    timeRange?: { start: Date; end: Date }
  ): Promise<Aircraft[]>;
}

export interface IDocumentDatabase extends IService {
  // Flight Strips
  saveFlightStrip(flightStrip: FlightStrip): Promise<string>;
  getFlightStrip(id: string): Promise<FlightStrip | null>;
  updateFlightStrip(id: string, updates: Partial<FlightStrip>): Promise<FlightStrip>;
  deleteFlightStrip(id: string): Promise<void>;
  queryFlightStrips(query: any): Promise<FlightStrip[]>;

  // Radio Transmissions
  saveTransmission(transmission: RadioTransmission): Promise<string>;
  getTransmissions(
    filters: {
      callsign?: string;
      frequency?: string;
      startTime?: Date;
      endTime?: Date;
    }
  ): Promise<RadioTransmission[]>;
  
  searchTransmissions(searchText: string): Promise<RadioTransmission[]>;

  // Alerts and Conflicts
  saveAlert(alert: Alert): Promise<string>;
  saveConflict(conflict: Conflict): Promise<string>;
  getActiveAlerts(): Promise<Alert[]>;
  getActiveConflicts(): Promise<Conflict[]>;
}

export interface ICacheService extends IService {
  set(key: string, value: any, ttlSeconds?: number): Promise<void>;
  get<T>(key: string): Promise<T | null>;
  delete(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
  
  // Specialized cache operations
  cacheConflictDetection(aircraft: Aircraft[], conflicts: Conflict[]): Promise<void>;
  getCachedConflicts(): Promise<Conflict[] | null>;
  
  cacheControllerSession(controllerId: string, sessionData: any): Promise<void>;
  getControllerSession(controllerId: string): Promise<any | null>;
}
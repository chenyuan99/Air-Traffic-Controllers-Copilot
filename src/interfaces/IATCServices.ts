import { IService } from './IService';
import { Aircraft, Conflict, FlightStrip, Alert } from '../types';

export interface IConflictDetectionService extends IService {
  detectConflicts(aircraft: Aircraft[]): Promise<Conflict[]>;
  analyzeConflict(conflict: Conflict): Promise<Conflict>;
  subscribeToConflicts(callback: (conflicts: Conflict[]) => void): void;
  updateConflictStatus(conflictId: string, status: string): Promise<void>;
}

export interface IFlightStripService extends IService {
  createFlightStrip(aircraft: Aircraft): Promise<FlightStrip>;
  updateFlightStrip(stripId: string, updates: Partial<FlightStrip>): Promise<FlightStrip>;
  getFlightStrip(stripId: string): Promise<FlightStrip | null>;
  getActiveFlightStrips(): Promise<FlightStrip[]>;
  deleteFlightStrip(stripId: string): Promise<void>;
}

export interface IRunwayManagementService extends IService {
  getRunwayStatus(): Promise<{
    runway: string;
    available: boolean;
    occupiedBy?: string;
    nextAvailable?: Date;
  }[]>;
  
  assignRunway(aircraftCallsign: string, runway: string): Promise<boolean>;
  optimizeTaxiRoute(
    aircraftCallsign: string, 
    origin: string, 
    destination: string
  ): Promise<{
    route: string[];
    estimatedTime: number;
  }>;
  
  detectGroundConflicts(): Promise<Conflict[]>;
}

export interface IAlertService extends IService {
  createAlert(alert: Omit<Alert, 'id' | 'timestamp'>): Promise<Alert>;
  getActiveAlerts(): Promise<Alert[]>;
  acknowledgeAlert(alertId: string, controllerId: string): Promise<void>;
  subscribeToAlerts(callback: (alert: Alert) => void): void;
  prioritizeAlerts(alerts: Alert[]): Alert[];
}
// Core data types for ATC Assistant System

export interface Position3D {
  latitude: number;
  longitude: number;
  altitude: number;
  timestamp: Date;
}

export interface Vector3D {
  x: number;
  y: number;
  z: number;
}

export enum AircraftStatus {
  DEPARTING = 'DEPARTING',
  ARRIVING = 'ARRIVING',
  TAXIING = 'TAXIING',
  HOLDING = 'HOLDING',
  EMERGENCY = 'EMERGENCY',
  UNKNOWN = 'UNKNOWN'
}

export enum ConflictType {
  SEPARATION_VIOLATION = 'SEPARATION_VIOLATION',
  RUNWAY_INCURSION = 'RUNWAY_INCURSION',
  ALTITUDE_CONFLICT = 'ALTITUDE_CONFLICT',
  GROUND_CONFLICT = 'GROUND_CONFLICT'
}

export enum SeverityLevel {
  LOW = 'LOW',
  MEDIUM = 'MEDIUM',
  HIGH = 'HIGH',
  CRITICAL = 'CRITICAL'
}

export enum ConflictStatus {
  DETECTED = 'DETECTED',
  ACKNOWLEDGED = 'ACKNOWLEDGED',
  RESOLVING = 'RESOLVING',
  RESOLVED = 'RESOLVED'
}

export interface FlightPlan {
  origin: string;
  destination: string;
  route: string;
  cruiseAltitude: number;
  estimatedDeparture: Date;
  estimatedArrival: Date;
}

export interface Clearance {
  id: string;
  type: string;
  instruction: string;
  altitude?: number;
  heading?: number;
  speed?: number;
  timestamp: Date;
  acknowledged: boolean;
}

export interface Aircraft {
  callsign: string;
  flightPlan: FlightPlan;
  currentPosition: Position3D;
  velocity: Vector3D;
  altitude: number;
  heading: number;
  squawkCode: string;
  status: AircraftStatus;
  clearances: Clearance[];
  lastUpdate: Date;
}

export interface ControllerAction {
  id: string;
  action: string;
  timestamp: Date;
  controllerId: string;
  notes?: string;
}

export interface Alert {
  id: string;
  type: string;
  severity: SeverityLevel;
  message: string;
  timestamp: Date;
  acknowledged: boolean;
  aircraftInvolved?: string[];
}

export interface FlightStrip {
  id: string;
  aircraft: Aircraft;
  route: string;
  altitude: number;
  speed: number;
  remarks: string;
  controllerActions: ControllerAction[];
  systemAlerts: Alert[];
  createdAt: Date;
  updatedAt: Date;
}

export interface ResolutionOption {
  id: string;
  description: string;
  instructions: string[];
  estimatedResolutionTime: number;
  confidence: number;
}

export interface Conflict {
  id: string;
  aircraftInvolved: Aircraft[];
  conflictType: ConflictType;
  timeToConflict: number;
  severity: SeverityLevel;
  resolutionOptions: ResolutionOption[];
  status: ConflictStatus;
  detectedAt: Date;
}

export interface ComplianceResult {
  isCompliant: boolean;
  confidence: number;
  issues: string[];
  suggestions: string[];
}

export interface RadioTransmission {
  id: string;
  timestamp: Date;
  frequency: string;
  callsign: string;
  controller: string;
  audioData?: Buffer;
  transcription: string;
  confidence: number;
  phraseologyCompliance: ComplianceResult;
}

export interface WeatherData {
  timestamp: Date;
  temperature: number;
  windSpeed: number;
  windDirection: number;
  visibility: number;
  ceiling?: number;
  precipitation?: string;
  pressure: number;
}

export interface SystemConfig {
  openai: {
    apiKey: string;
    model: string;
    whisperModel: string;
  };
  database: {
    influxdb: {
      url: string;
      token: string;
      org: string;
      bucket: string;
    };
    mongodb: {
      url: string;
      database: string;
    };
    redis: {
      url: string;
      password?: string;
    };
  };
  alerts: {
    conflictDetectionInterval: number;
    transcriptionTimeout: number;
    alertRetentionDays: number;
  };
  airport: {
    code: string;
    runways: string[];
    frequencies: string[];
  };
}
import { IConflictDetectionService } from '../interfaces/IATCServices';
import { ILogger, IConfigService } from '../interfaces/IService';
import { Aircraft, Conflict, ConflictType, SeverityLevel, ConflictStatus, ResolutionOption, Position3D, Vector3D } from '../types';
import { EventEmitter } from '../core/EventEmitter';
import { OpenAIService } from './OpenAIService';

export interface ConflictParameters {
  horizontalSeparation: number; // nautical miles
  verticalSeparation: number; // feet
  timeHorizon: number; // seconds
  alertThresholds: {
    caution: number; // seconds
    warning: number; // seconds
    critical: number; // seconds
  };
}

export interface TrajectoryPrediction {
  aircraft: Aircraft;
  predictedPositions: Position3D[];
  timeStamps: Date[];
  confidence: number;
  uncertaintyRadius: number; // nautical miles
}

export interface ConflictGeometry {
  closestPointOfApproach: {
    time: Date;
    aircraft1Position: Position3D;
    aircraft2Position: Position3D;
    horizontalSeparation: number;
    verticalSeparation: number;
  };
  conflictArea: {
    center: Position3D;
    radius: number;
    entryTimes: { aircraft1: Date; aircraft2: Date };
    exitTimes: { aircraft1: Date; aircraft2: Date };
  };
}

export interface ConflictAnalysis {
  conflictId: string;
  geometry: ConflictGeometry;
  riskAssessment: RiskAssessment;
  contributingFactors: string[];
  recommendedActions: string[];
  alternativeResolutions: ResolutionOption[];
}

export interface RiskAssessment {
  collisionProbability: number;
  severityScore: number;
  urgencyLevel: number;
  weatherImpact: number;
  trafficDensityImpact: number;
  controllerWorkloadImpact: number;
}

export class ConflictDetectionService implements IConflictDetectionService {
  private logger: ILogger;
  private config: IConfigService;
  private eventEmitter: EventEmitter;
  private openAIService: OpenAIService;
  private isRunning = false;
  private activeConflicts = new Map<string, Conflict>();
  private conflictHistory: Conflict[] = [];
  private subscribers: Array<(conflicts: Conflict[]) => void> = [];
  private detectionInterval?: NodeJS.Timer;
  private trajectoryCache = new Map<string, TrajectoryPrediction>();

  // Standard separation requirements
  private separationStandards: ConflictParameters = {
    horizontalSeparation: 3.0, // 3 NM horizontal
    verticalSeparation: 1000, // 1000 feet vertical
    timeHorizon: 300, // 5 minutes lookahead
    alertThresholds: {
      caution: 180, // 3 minutes
      warning: 120, // 2 minutes
      critical: 60 // 1 minute
    }
  };

  constructor(
    logger: ILogger,
    config: IConfigService,
    eventEmitter: EventEmitter,
    openAIService: OpenAIService
  ) {
    this.logger = logger;
    this.config = config;
    this.eventEmitter = eventEmitter;
    this.openAIService = openAIService;
    this.loadSeparationStandards();
  }

  async initialize(): Promise<void> {
    await this.openAIService.initialize();
    this.startConflictDetection();
    this.isRunning = true;
    this.logger.info('Conflict Detection Service initialized');
  }

  async shutdown(): Promise<void> {
    this.isRunning = false;
    
    if (this.detectionInterval) {
      clearInterval(this.detectionInterval);
    }
    
    this.activeConflicts.clear();
    this.trajectoryCache.clear();
    this.subscribers = [];
    
    await this.openAIService.shutdown();
    this.logger.info('Conflict Detection Service shutdown completed');
  }

  async isHealthy(): Promise<boolean> {
    return this.isRunning && await this.openAIService.isHealthy();
  }

  // Main conflict detection method
  async detectConflicts(aircraft: Aircraft[]): Promise<Conflict[]> {
    const startTime = Date.now();
    const detectedConflicts: Conflict[] = [];

    try {
      // Filter active aircraft
      const activeAircraft = this.filterActiveAircraft(aircraft);
      
      if (activeAircraft.length < 2) {
        return detectedConflicts;
      }

      // Generate trajectory predictions
      const trajectories = await this.generateTrajectoryPredictions(activeAircraft);
      
      // Detect pairwise conflicts
      for (let i = 0; i < activeAircraft.length; i++) {
        for (let j = i + 1; j < activeAircraft.length; j++) {
          const aircraft1 = activeAircraft[i];
          const aircraft2 = activeAircraft[j];
          
          const conflict = await this.detectPairwiseConflict(
            aircraft1, aircraft2,
            trajectories.get(aircraft1.callsign),
            trajectories.get(aircraft2.callsign)
          );
          
          if (conflict) {
            detectedConflicts.push(conflict);
          }
        }
      }

      // Update active conflicts
      this.updateActiveConflicts(detectedConflicts);
      
      // Notify subscribers
      this.notifySubscribers(Array.from(this.activeConflicts.values()));

      const processingTime = Date.now() - startTime;
      
      this.logger.debug('Conflict detection completed', {
        aircraftCount: activeAircraft.length,
        conflictsDetected: detectedConflicts.length,
        activeConflicts: this.activeConflicts.size,
        processingTime
      });

      // Emit conflict detection event
      this.eventEmitter.emit('conflict:detection_completed', {
        aircraft: activeAircraft,
        conflicts: detectedConflicts,
        processingTime
      });

      return Array.from(this.activeConflicts.values());
    } catch (error) {
      this.logger.error('Conflict detection failed', error as Error);
      throw error;
    }
  }

  // Analyze specific conflict in detail
  async analyzeConflict(conflict: Conflict): Promise<Conflict> {
    try {
      const startTime = Date.now();
      
      // Generate detailed conflict analysis
      const analysis = await this.generateConflictAnalysis(conflict);
      
      // Get AI-powered resolution suggestions
      const aiResolutions = await this.openAIService.generateConflictResolutions(
        this.buildConflictDescription(conflict),
        conflict.aircraftInvolved.map(ac => ({
          callsign: ac.callsign,
          altitude: ac.altitude,
          heading: ac.heading,
          speed: this.calculateGroundSpeed(ac.velocity),
          position: ac.currentPosition,
          status: ac.status
        }))
      );

      // Enhance conflict with analysis results
      const enhancedConflict: Conflict = {
        ...conflict,
        resolutionOptions: [
          ...conflict.resolutionOptions,
          ...aiResolutions
        ]
      };

      // Update in active conflicts
      this.activeConflicts.set(conflict.id, enhancedConflict);
      
      const processingTime = Date.now() - startTime;
      
      this.logger.info('Conflict analysis completed', {
        conflictId: conflict.id,
        resolutionCount: enhancedConflict.resolutionOptions.length,
        processingTime
      });

      // Emit conflict analysis event
      this.eventEmitter.emit('conflict:analysis_completed', {
        conflict: enhancedConflict,
        analysis,
        processingTime
      });

      return enhancedConflict;
    } catch (error) {
      this.logger.error('Conflict analysis failed', error as Error, {
        conflictId: conflict.id
      });
      throw error;
    }
  }

  // Subscribe to conflict updates
  subscribeToConflicts(callback: (conflicts: Conflict[]) => void): void {
    this.subscribers.push(callback);
    this.logger.debug('New conflict subscriber added', {
      subscriberCount: this.subscribers.length
    });
  }

  // Update conflict status
  async updateConflictStatus(conflictId: string, status: string): Promise<void> {
    const conflict = this.activeConflicts.get(conflictId);
    if (!conflict) {
      throw new Error(`Conflict ${conflictId} not found`);
    }

    const updatedConflict: Conflict = {
      ...conflict,
      status: status as ConflictStatus
    };

    this.activeConflicts.set(conflictId, updatedConflict);
    
    // If resolved, move to history
    if (status === ConflictStatus.RESOLVED) {
      this.moveConflictToHistory(conflictId);
    }

    this.logger.info('Conflict status updated', {
      conflictId,
      oldStatus: conflict.status,
      newStatus: status
    });

    this.eventEmitter.emit('conflict:status_updated', {
      conflictId,
      conflict: updatedConflict,
      previousStatus: conflict.status
    });
  }

  // Get active conflicts
  getActiveConflicts(): Conflict[] {
    return Array.from(this.activeConflicts.values());
  }

  // Get conflict history
  getConflictHistory(hours: number = 24): Conflict[] {
    const cutoffTime = new Date(Date.now() - hours * 60 * 60 * 1000);
    return this.conflictHistory.filter(c => c.detectedAt >= cutoffTime);
  }

  // Get conflict statistics
  getConflictStatistics(): {
    activeCount: number;
    resolvedToday: number;
    averageResolutionTime: number;
    conflictsByType: { [key: string]: number };
    conflictsBySeverity: { [key: string]: number };
  } {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    const todayConflicts = this.conflictHistory.filter(c => c.detectedAt >= today);
    const resolvedConflicts = todayConflicts.filter(c => c.status === ConflictStatus.RESOLVED);
    
    const conflictsByType: { [key: string]: number } = {};
    const conflictsBySeverity: { [key: string]: number } = {};
    
    for (const conflict of todayConflicts) {
      conflictsByType[conflict.conflictType] = (conflictsByType[conflict.conflictType] || 0) + 1;
      conflictsBySeverity[conflict.severity] = (conflictsBySeverity[conflict.severity] || 0) + 1;
    }
    
    const averageResolutionTime = resolvedConflicts.length > 0 ?
      resolvedConflicts.reduce((sum, c) => sum + (c.timeToConflict || 0), 0) / resolvedConflicts.length : 0;

    return {
      activeCount: this.activeConflicts.size,
      resolvedToday: resolvedConflicts.length,
      averageResolutionTime,
      conflictsByType,
      conflictsBySeverity
    };
  }

  // Private helper methods
  private loadSeparationStandards(): void {
    // Load separation standards from configuration
    const configStandards = this.config.get<any>('separationStandards') || {};
    
    this.separationStandards = {
      ...this.separationStandards,
      ...configStandards
    };
    
    this.logger.info('Separation standards loaded', this.separationStandards);
  }

  private filterActiveAircraft(aircraft: Aircraft[]): Aircraft[] {
    const now = new Date();
    const staleThreshold = 30000; // 30 seconds
    
    return aircraft.filter(ac => {
      const age = now.getTime() - ac.lastUpdate.getTime();
      return age < staleThreshold && ac.altitude > 0;
    });
  }

  private async generateTrajectoryPredictions(aircraft: Aircraft[]): Promise<Map<string, TrajectoryPrediction>> {
    const predictions = new Map<string, TrajectoryPrediction>();
    
    for (const ac of aircraft) {
      // Check cache first
      const cached = this.trajectoryCache.get(ac.callsign);
      if (cached && this.isTrajectoryValid(cached, ac)) {
        predictions.set(ac.callsign, cached);
        continue;
      }
      
      // Generate new trajectory prediction
      const prediction = this.predictTrajectory(ac);
      predictions.set(ac.callsign, prediction);
      this.trajectoryCache.set(ac.callsign, prediction);
    }
    
    return predictions;
  }

  private predictTrajectory(aircraft: Aircraft): TrajectoryPrediction {
    const predictions: Position3D[] = [];
    const timeStamps: Date[] = [];
    const timeStep = 10; // 10 second intervals
    const maxTime = this.separationStandards.timeHorizon;
    
    let currentPosition = { ...aircraft.currentPosition };
    let currentVelocity = { ...aircraft.velocity };
    
    for (let t = 0; t <= maxTime; t += timeStep) {
      const timestamp = new Date(aircraft.lastUpdate.getTime() + t * 1000);
      
      // Simple linear prediction (could be enhanced with flight plan data)
      const predictedPosition: Position3D = {
        latitude: currentPosition.latitude + (currentVelocity.y * t) / 111320, // Convert m/s to degrees
        longitude: currentPosition.longitude + (currentVelocity.x * t) / (111320 * Math.cos(currentPosition.latitude * Math.PI / 180)),
        altitude: currentPosition.altitude + (currentVelocity.z * t * 3.28084), // Convert m/s to ft/s
        timestamp
      };
      
      predictions.push(predictedPosition);
      timeStamps.push(timestamp);
    }
    
    return {
      aircraft,
      predictedPositions: predictions,
      timeStamps,
      confidence: this.calculateTrajectoryConfidence(aircraft),
      uncertaintyRadius: this.calculateUncertaintyRadius(aircraft)
    };
  }

  private async detectPairwiseConflict(
    aircraft1: Aircraft,
    aircraft2: Aircraft,
    trajectory1?: TrajectoryPrediction,
    trajectory2?: TrajectoryPrediction
  ): Promise<Conflict | null> {
    
    if (!trajectory1 || !trajectory2) {
      return null;
    }

    // Check for potential conflicts along trajectories
    let minSeparation = Infinity;
    let conflictTime: Date | null = null;
    let conflictPosition1: Position3D | null = null;
    let conflictPosition2: Position3D | null = null;

    for (let i = 0; i < Math.min(trajectory1.predictedPositions.length, trajectory2.predictedPositions.length); i++) {
      const pos1 = trajectory1.predictedPositions[i];
      const pos2 = trajectory2.predictedPositions[i];
      
      const horizontalSep = this.calculateHorizontalDistance(pos1, pos2);
      const verticalSep = Math.abs(pos1.altitude - pos2.altitude);
      
      const totalSeparation = Math.sqrt(
        Math.pow(horizontalSep, 2) + Math.pow(verticalSep / 6076.12, 2) // Convert feet to NM
      );
      
      if (totalSeparation < minSeparation) {
        minSeparation = totalSeparation;
        conflictTime = trajectory1.timeStamps[i];
        conflictPosition1 = pos1;
        conflictPosition2 = pos2;
      }
    }

    // Check if separation violation occurs
    if (minSeparation < this.separationStandards.horizontalSeparation && conflictTime) {
      const timeToConflict = (conflictTime.getTime() - Date.now()) / 1000;
      
      if (timeToConflict > 0 && timeToConflict <= this.separationStandards.timeHorizon) {
        const conflictType = this.determineConflictType(aircraft1, aircraft2, conflictPosition1!, conflictPosition2!);
        const severity = this.calculateSeverity(minSeparation, timeToConflict);
        
        const conflict: Conflict = {
          id: `conflict_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
          aircraftInvolved: [aircraft1, aircraft2],
          conflictType,
          timeToConflict,
          severity,
          resolutionOptions: [],
          status: ConflictStatus.DETECTED,
          detectedAt: new Date()
        };
        
        return conflict;
      }
    }
    
    return null;
  }

  private async generateConflictAnalysis(conflict: Conflict): Promise<ConflictAnalysis> {
    const geometry = this.calculateConflictGeometry(conflict);
    const riskAssessment = this.assessConflictRisk(conflict);
    const contributingFactors = this.identifyContributingFactors(conflict);
    const recommendedActions = this.generateRecommendedActions(conflict);
    
    return {
      conflictId: conflict.id,
      geometry,
      riskAssessment,
      contributingFactors,
      recommendedActions,
      alternativeResolutions: []
    };
  }

  private calculateConflictGeometry(conflict: Conflict): ConflictGeometry {
    const aircraft1 = conflict.aircraftInvolved[0];
    const aircraft2 = conflict.aircraftInvolved[1];
    
    // Simplified geometry calculation
    const midpoint: Position3D = {
      latitude: (aircraft1.currentPosition.latitude + aircraft2.currentPosition.latitude) / 2,
      longitude: (aircraft1.currentPosition.longitude + aircraft2.currentPosition.longitude) / 2,
      altitude: (aircraft1.currentPosition.altitude + aircraft2.currentPosition.altitude) / 2,
      timestamp: new Date()
    };
    
    const conflictTime = new Date(Date.now() + conflict.timeToConflict * 1000);
    
    return {
      closestPointOfApproach: {
        time: conflictTime,
        aircraft1Position: aircraft1.currentPosition,
        aircraft2Position: aircraft2.currentPosition,
        horizontalSeparation: this.calculateHorizontalDistance(
          aircraft1.currentPosition,
          aircraft2.currentPosition
        ),
        verticalSeparation: Math.abs(aircraft1.altitude - aircraft2.altitude)
      },
      conflictArea: {
        center: midpoint,
        radius: 5, // NM
        entryTimes: {
          aircraft1: new Date(conflictTime.getTime() - 60000),
          aircraft2: new Date(conflictTime.getTime() - 60000)
        },
        exitTimes: {
          aircraft1: new Date(conflictTime.getTime() + 60000),
          aircraft2: new Date(conflictTime.getTime() + 60000)
        }
      }
    };
  }

  private assessConflictRisk(conflict: Conflict): RiskAssessment {
    const timeToConflict = conflict.timeToConflict;
    const severity = conflict.severity;
    
    // Calculate various risk factors
    const collisionProbability = this.calculateCollisionProbability(conflict);
    const severityScore = this.mapSeverityToScore(severity);
    const urgencyLevel = Math.max(0, 1 - (timeToConflict / 300)); // 0-1 scale based on 5 min horizon
    
    return {
      collisionProbability,
      severityScore,
      urgencyLevel,
      weatherImpact: 0.1, // Placeholder
      trafficDensityImpact: 0.2, // Placeholder
      controllerWorkloadImpact: 0.15 // Placeholder
    };
  }

  private identifyContributingFactors(conflict: Conflict): string[] {
    const factors: string[] = [];
    
    // Analyze aircraft characteristics
    const aircraft1 = conflict.aircraftInvolved[0];
    const aircraft2 = conflict.aircraftInvolved[1];
    
    if (Math.abs(aircraft1.altitude - aircraft2.altitude) < 500) {
      factors.push('Aircraft at similar altitudes');
    }
    
    if (this.calculateGroundSpeed(aircraft1.velocity) > 250 || 
        this.calculateGroundSpeed(aircraft2.velocity) > 250) {
      factors.push('High-speed aircraft involved');
    }
    
    if (conflict.timeToConflict < 120) {
      factors.push('Short time to conflict');
    }
    
    return factors;
  }

  private generateRecommendedActions(conflict: Conflict): string[] {
    const actions: string[] = [];
    
    switch (conflict.severity) {
      case SeverityLevel.CRITICAL:
        actions.push('Immediate vector or altitude change required');
        actions.push('Issue traffic advisory to both aircraft');
        actions.push('Monitor closely until separation restored');
        break;
        
      case SeverityLevel.HIGH:
        actions.push('Issue preventive control instructions');
        actions.push('Coordinate with adjacent sectors if needed');
        break;
        
      case SeverityLevel.MEDIUM:
        actions.push('Monitor aircraft progress');
        actions.push('Prepare contingency instructions');
        break;
        
      default:
        actions.push('Continue monitoring');
    }
    
    return actions;
  }

  private determineConflictType(
    aircraft1: Aircraft,
    aircraft2: Aircraft,
    pos1: Position3D,
    pos2: Position3D
  ): ConflictType {
    const altitudeDiff = Math.abs(pos1.altitude - pos2.altitude);
    
    if (altitudeDiff < 500) {
      return ConflictType.SEPARATION_VIOLATION;
    } else if (pos1.altitude < 1000 || pos2.altitude < 1000) {
      return ConflictType.GROUND_CONFLICT;
    } else {
      return ConflictType.ALTITUDE_CONFLICT;
    }
  }

  private calculateSeverity(separation: number, timeToConflict: number): SeverityLevel {
    if (separation < 1.0 && timeToConflict < 60) {
      return SeverityLevel.CRITICAL;
    } else if (separation < 2.0 && timeToConflict < 120) {
      return SeverityLevel.HIGH;
    } else if (separation < 3.0 && timeToConflict < 180) {
      return SeverityLevel.MEDIUM;
    } else {
      return SeverityLevel.LOW;
    }
  }

  private calculateHorizontalDistance(pos1: Position3D, pos2: Position3D): number {
    const R = 3440.065; // Earth's radius in nautical miles
    const dLat = (pos2.latitude - pos1.latitude) * Math.PI / 180;
    const dLon = (pos2.longitude - pos1.longitude) * Math.PI / 180;
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
              Math.cos(pos1.latitude * Math.PI / 180) * Math.cos(pos2.latitude * Math.PI / 180) *
              Math.sin(dLon/2) * Math.sin(dLon/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c;
  }

  private calculateGroundSpeed(velocity: Vector3D): number {
    return Math.sqrt(velocity.x * velocity.x + velocity.y * velocity.y) * 1.94384; // Convert m/s to knots
  }

  private calculateTrajectoryConfidence(aircraft: Aircraft): number {
    // Base confidence on data age and aircraft status
    const dataAge = (Date.now() - aircraft.lastUpdate.getTime()) / 1000;
    const ageConfidence = Math.max(0.1, 1 - (dataAge / 30)); // Decrease over 30 seconds
    
    const statusConfidence = aircraft.status === 'UNKNOWN' ? 0.5 : 0.9;
    
    return ageConfidence * statusConfidence;
  }

  private calculateUncertaintyRadius(aircraft: Aircraft): number {
    // Uncertainty increases with time and decreases with data quality
    const baseUncertainty = 0.5; // NM
    const dataAge = (Date.now() - aircraft.lastUpdate.getTime()) / 1000;
    return baseUncertainty + (dataAge / 60) * 0.1; // Increase by 0.1 NM per minute
  }

  private isTrajectoryValid(trajectory: TrajectoryPrediction, aircraft: Aircraft): boolean {
    const age = Date.now() - trajectory.timeStamps[0].getTime();
    return age < 30000; // 30 seconds
  }

  private calculateCollisionProbability(conflict: Conflict): number {
    // Simplified collision probability calculation
    const timeToConflict = conflict.timeToConflict;
    const severity = conflict.severity;
    
    let baseProbability = 0.01; // 1% base probability
    
    switch (severity) {
      case SeverityLevel.CRITICAL:
        baseProbability = 0.1;
        break;
      case SeverityLevel.HIGH:
        baseProbability = 0.05;
        break;
      case SeverityLevel.MEDIUM:
        baseProbability = 0.02;
        break;
    }
    
    // Increase probability as time decreases
    const timeFactor = Math.max(0.1, 1 - (timeToConflict / 300));
    
    return Math.min(0.5, baseProbability * (1 + timeFactor));
  }

  private mapSeverityToScore(severity: SeverityLevel): number {
    switch (severity) {
      case SeverityLevel.CRITICAL: return 1.0;
      case SeverityLevel.HIGH: return 0.75;
      case SeverityLevel.MEDIUM: return 0.5;
      case SeverityLevel.LOW: return 0.25;
      default: return 0.1;
    }
  }

  private buildConflictDescription(conflict: Conflict): string {
    const aircraft = conflict.aircraftInvolved;
    return `${conflict.conflictType} between ${aircraft.length} aircraft. ` +
           `Time to conflict: ${conflict.timeToConflict} seconds. ` +
           `Severity: ${conflict.severity}. ` +
           `Aircraft: ${aircraft.map(a => `${a.callsign} at ${a.altitude}ft`).join(', ')}`;
  }

  private updateActiveConflicts(newConflicts: Conflict[]): void {
    // Remove resolved conflicts
    const currentConflictIds = new Set(newConflicts.map(c => c.id));
    
    for (const [id, conflict] of this.activeConflicts) {
      if (!currentConflictIds.has(id)) {
        // Conflict no longer detected - mark as resolved
        conflict.status = ConflictStatus.RESOLVED;
        this.moveConflictToHistory(id);
      }
    }
    
    // Add or update conflicts
    for (const conflict of newConflicts) {
      this.activeConflicts.set(conflict.id, conflict);
    }
  }

  private moveConflictToHistory(conflictId: string): void {
    const conflict = this.activeConflicts.get(conflictId);
    if (conflict) {
      this.conflictHistory.push(conflict);
      this.activeConflicts.delete(conflictId);
      
      // Keep only last 24 hours of history
      const cutoffTime = new Date(Date.now() - 24 * 60 * 60 * 1000);
      this.conflictHistory = this.conflictHistory.filter(c => c.detectedAt >= cutoffTime);
    }
  }

  private startConflictDetection(): void {
    const interval = this.config.get<number>('alerts.conflictDetectionInterval') || 5000;
    
    this.detectionInterval = setInterval(async () => {
      if (!this.isRunning) return;
      
      try {
        // This would be called with current aircraft data from radar service
        // For now, we'll emit an event requesting aircraft data
        this.eventEmitter.emit('conflict:request_aircraft_data');
      } catch (error) {
        this.logger.error('Periodic conflict detection failed', error as Error);
      }
    }, interval);
  }

  private notifySubscribers(conflicts: Conflict[]): void {
    for (const callback of this.subscribers) {
      try {
        callback(conflicts);
      } catch (error) {
        this.logger.error('Conflict subscriber callback failed', error as Error);
      }
    }
  }
}
import { IService, ILogger } from '../interfaces/IService';
import { Aircraft, FlightStrip, WeatherData, Alert } from '../types';
import { EventEmitter } from '../core/EventEmitter';

export interface SystemContext {
  currentWeather: WeatherData | null;
  activeAircraft: Map<string, Aircraft>;
  activeFlightStrips: Map<string, FlightStrip>;
  activeAlerts: Alert[];
  trafficDensity: TrafficDensity;
  operationalMode: OperationalMode;
  lastUpdated: Date;
}

export interface TrafficDensity {
  total: number;
  departing: number;
  arriving: number;
  taxiing: number;
  level: DensityLevel;
}

export enum DensityLevel {
  LOW = 'LOW',
  MODERATE = 'MODERATE',
  HIGH = 'HIGH',
  CRITICAL = 'CRITICAL'
}

export enum OperationalMode {
  NORMAL = 'NORMAL',
  REDUCED_VISIBILITY = 'REDUCED_VISIBILITY',
  SEVERE_WEATHER = 'SEVERE_WEATHER',
  EMERGENCY = 'EMERGENCY',
  GROUND_STOP = 'GROUND_STOP'
}

export interface ContextualInsight {
  type: InsightType;
  message: string;
  confidence: number;
  priority: number;
  relatedEntities: string[];
  timestamp: Date;
}

export enum InsightType {
  TRAFFIC_PATTERN = 'TRAFFIC_PATTERN',
  WEATHER_IMPACT = 'WEATHER_IMPACT',
  EFFICIENCY_OPPORTUNITY = 'EFFICIENCY_OPPORTUNITY',
  SAFETY_CONCERN = 'SAFETY_CONCERN',
  RESOURCE_OPTIMIZATION = 'RESOURCE_OPTIMIZATION'
}

export class ContextManager implements IService {
  private logger: ILogger;
  private eventEmitter: EventEmitter;
  private systemContext: SystemContext;
  private contextHistory: SystemContext[] = [];
  private insights: ContextualInsight[] = [];
  private updateInterval?: NodeJS.Timer;

  constructor(logger: ILogger, eventEmitter: EventEmitter) {
    this.logger = logger;
    this.eventEmitter = eventEmitter;
    
    this.systemContext = {
      currentWeather: null,
      activeAircraft: new Map(),
      activeFlightStrips: new Map(),
      activeAlerts: [],
      trafficDensity: {
        total: 0,
        departing: 0,
        arriving: 0,
        taxiing: 0,
        level: DensityLevel.LOW
      },
      operationalMode: OperationalMode.NORMAL,
      lastUpdated: new Date()
    };
  }

  async initialize(): Promise<void> {
    // Start context update cycle
    this.updateInterval = setInterval(() => {
      this.updateContext();
    }, 5000); // Update every 5 seconds

    // Subscribe to relevant events
    this.setupEventListeners();
    
    this.logger.info('Context Manager initialized');
  }

  async shutdown(): Promise<void> {
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
    }
    
    this.logger.info('Context Manager shutdown completed');
  }

  async isHealthy(): Promise<boolean> {
    return this.systemContext.lastUpdated && 
           (Date.now() - this.systemContext.lastUpdated.getTime()) < 30000; // Updated within 30 seconds
  }

  // Update aircraft information
  updateAircraft(aircraft: Aircraft): void {
    this.systemContext.activeAircraft.set(aircraft.callsign, aircraft);
    this.systemContext.lastUpdated = new Date();
    
    this.logger.debug('Aircraft context updated', {
      callsign: aircraft.callsign,
      status: aircraft.status,
      altitude: aircraft.altitude
    });
  }

  // Remove aircraft from context
  removeAircraft(callsign: string): void {
    this.systemContext.activeAircraft.delete(callsign);
    this.systemContext.lastUpdated = new Date();
    
    this.logger.debug('Aircraft removed from context', { callsign });
  }

  // Update flight strip information
  updateFlightStrip(flightStrip: FlightStrip): void {
    this.systemContext.activeFlightStrips.set(flightStrip.id, flightStrip);
    this.systemContext.lastUpdated = new Date();
  }

  // Update weather information
  updateWeather(weather: WeatherData): void {
    const previousWeather = this.systemContext.currentWeather;
    this.systemContext.currentWeather = weather;
    this.systemContext.lastUpdated = new Date();
    
    // Check for significant weather changes
    if (previousWeather) {
      this.analyzeWeatherChange(previousWeather, weather);
    }
    
    // Update operational mode based on weather
    this.updateOperationalMode();
    
    this.logger.info('Weather context updated', {
      temperature: weather.temperature,
      windSpeed: weather.windSpeed,
      visibility: weather.visibility
    });
  }

  // Add alert to context
  addAlert(alert: Alert): void {
    this.systemContext.activeAlerts.push(alert);
    this.systemContext.lastUpdated = new Date();
    
    // Update operational mode if emergency alert
    if (alert.severity === 'CRITICAL') {
      this.systemContext.operationalMode = OperationalMode.EMERGENCY;
    }
  }

  // Remove alert from context
  removeAlert(alertId: string): void {
    this.systemContext.activeAlerts = this.systemContext.activeAlerts.filter(
      alert => alert.id !== alertId
    );
    this.systemContext.lastUpdated = new Date();
    
    // Re-evaluate operational mode
    this.updateOperationalMode();
  }

  // Get current system context
  getCurrentContext(): SystemContext {
    return { ...this.systemContext };
  }

  // Get contextual summary for AI processing
  getContextualSummary(): string {
    const context = this.systemContext;
    const aircraft = Array.from(context.activeAircraft.values());
    
    let summary = `Current ATC Context:\n`;
    summary += `- Traffic: ${context.trafficDensity.total} aircraft (${context.trafficDensity.level} density)\n`;
    summary += `- Operational Mode: ${context.operationalMode}\n`;
    
    if (context.currentWeather) {
      const weather = context.currentWeather;
      summary += `- Weather: Wind ${weather.windDirection}°/${weather.windSpeed}kt, `;
      summary += `Visibility ${weather.visibility}sm, Temp ${weather.temperature}°C\n`;
    }
    
    if (context.activeAlerts.length > 0) {
      summary += `- Active Alerts: ${context.activeAlerts.length}\n`;
    }
    
    // Add aircraft summary
    if (aircraft.length > 0) {
      summary += `- Aircraft Status:\n`;
      aircraft.slice(0, 5).forEach(ac => {
        summary += `  ${ac.callsign}: ${ac.status} at ${ac.altitude}ft\n`;
      });
      
      if (aircraft.length > 5) {
        summary += `  ... and ${aircraft.length - 5} more aircraft\n`;
      }
    }
    
    return summary;
  }

  // Get contextual insights
  getContextualInsights(): ContextualInsight[] {
    return [...this.insights].sort((a, b) => b.priority - a.priority);
  }

  // Generate context-aware recommendations
  generateRecommendations(): string[] {
    const recommendations: string[] = [];
    const context = this.systemContext;
    
    // Traffic density recommendations
    if (context.trafficDensity.level === DensityLevel.HIGH) {
      recommendations.push('Consider implementing flow control measures');
      recommendations.push('Monitor separation closely due to high traffic density');
    }
    
    // Weather-based recommendations
    if (context.currentWeather) {
      const weather = context.currentWeather;
      
      if (weather.windSpeed > 25) {
        recommendations.push('Strong winds detected - consider runway changes');
      }
      
      if (weather.visibility < 3) {
        recommendations.push('Reduced visibility - implement IFR procedures');
      }
      
      if (weather.precipitation) {
        recommendations.push('Precipitation active - monitor braking conditions');
      }
    }
    
    // Alert-based recommendations
    if (context.activeAlerts.length > 3) {
      recommendations.push('Multiple active alerts - prioritize critical issues');
    }
    
    return recommendations;
  }

  // Get aircraft in specific area or meeting criteria
  getAircraftByCriteria(criteria: {
    status?: string;
    altitudeRange?: { min: number; max: number };
    area?: { lat: number; lon: number; radius: number };
  }): Aircraft[] {
    const aircraft = Array.from(this.systemContext.activeAircraft.values());
    
    return aircraft.filter(ac => {
      if (criteria.status && ac.status !== criteria.status) {
        return false;
      }
      
      if (criteria.altitudeRange) {
        if (ac.altitude < criteria.altitudeRange.min || 
            ac.altitude > criteria.altitudeRange.max) {
          return false;
        }
      }
      
      if (criteria.area) {
        const distance = this.calculateDistance(
          ac.currentPosition.latitude,
          ac.currentPosition.longitude,
          criteria.area.lat,
          criteria.area.lon
        );
        if (distance > criteria.area.radius) {
          return false;
        }
      }
      
      return true;
    });
  }

  // Private helper methods
  private setupEventListeners(): void {
    this.eventEmitter.on('aircraft:position_updated', (data) => {
      this.updateAircraft(data.aircraft);
    });
    
    this.eventEmitter.on('weather:updated', (data) => {
      this.updateWeather(data.weather);
    });
    
    this.eventEmitter.on('alert:created', (data) => {
      this.addAlert(data.alert);
    });
    
    this.eventEmitter.on('alert:resolved', (data) => {
      this.removeAlert(data.alertId);
    });
  }

  private updateContext(): void {
    // Update traffic density
    this.updateTrafficDensity();
    
    // Generate insights
    this.generateInsights();
    
    // Store context history
    this.storeContextHistory();
    
    // Clean up old data
    this.cleanupOldData();
    
    this.systemContext.lastUpdated = new Date();
  }

  private updateTrafficDensity(): void {
    const aircraft = Array.from(this.systemContext.activeAircraft.values());
    
    const density: TrafficDensity = {
      total: aircraft.length,
      departing: aircraft.filter(ac => ac.status === 'DEPARTING').length,
      arriving: aircraft.filter(ac => ac.status === 'ARRIVING').length,
      taxiing: aircraft.filter(ac => ac.status === 'TAXIING').length,
      level: DensityLevel.LOW
    };
    
    // Determine density level
    if (density.total > 20) {
      density.level = DensityLevel.CRITICAL;
    } else if (density.total > 15) {
      density.level = DensityLevel.HIGH;
    } else if (density.total > 8) {
      density.level = DensityLevel.MODERATE;
    }
    
    this.systemContext.trafficDensity = density;
  }

  private updateOperationalMode(): void {
    const context = this.systemContext;
    
    // Check for emergency conditions
    if (context.activeAlerts.some(alert => alert.severity === 'CRITICAL')) {
      context.operationalMode = OperationalMode.EMERGENCY;
      return;
    }
    
    // Check weather conditions
    if (context.currentWeather) {
      const weather = context.currentWeather;
      
      if (weather.visibility < 1 || weather.windSpeed > 35) {
        context.operationalMode = OperationalMode.SEVERE_WEATHER;
        return;
      }
      
      if (weather.visibility < 3 || weather.windSpeed > 25) {
        context.operationalMode = OperationalMode.REDUCED_VISIBILITY;
        return;
      }
    }
    
    // Default to normal
    context.operationalMode = OperationalMode.NORMAL;
  }

  private analyzeWeatherChange(previous: WeatherData, current: WeatherData): void {
    const windChange = Math.abs(current.windSpeed - previous.windSpeed);
    const visibilityChange = Math.abs(current.visibility - previous.visibility);
    
    if (windChange > 10) {
      this.addInsight({
        type: InsightType.WEATHER_IMPACT,
        message: `Significant wind change detected: ${windChange}kt difference`,
        confidence: 0.9,
        priority: 8,
        relatedEntities: [],
        timestamp: new Date()
      });
    }
    
    if (visibilityChange > 2) {
      this.addInsight({
        type: InsightType.WEATHER_IMPACT,
        message: `Visibility change: ${visibilityChange}sm difference`,
        confidence: 0.9,
        priority: 7,
        relatedEntities: [],
        timestamp: new Date()
      });
    }
  }

  private generateInsights(): void {
    // Traffic pattern insights
    if (this.systemContext.trafficDensity.level === DensityLevel.HIGH) {
      this.addInsight({
        type: InsightType.TRAFFIC_PATTERN,
        message: 'High traffic density detected - consider flow management',
        confidence: 0.8,
        priority: 6,
        relatedEntities: [],
        timestamp: new Date()
      });
    }
    
    // Clean up old insights (keep only last hour)
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    this.insights = this.insights.filter(insight => insight.timestamp > oneHourAgo);
  }

  private addInsight(insight: ContextualInsight): void {
    // Avoid duplicate insights
    const exists = this.insights.some(existing => 
      existing.type === insight.type && 
      existing.message === insight.message &&
      (Date.now() - existing.timestamp.getTime()) < 300000 // Within 5 minutes
    );
    
    if (!exists) {
      this.insights.push(insight);
      this.eventEmitter.emit('context:insight_generated', { insight });
    }
  }

  private storeContextHistory(): void {
    this.contextHistory.push({ ...this.systemContext });
    
    // Keep only last 24 hours of history
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    this.contextHistory = this.contextHistory.filter(
      context => context.lastUpdated > oneDayAgo
    );
  }

  private cleanupOldData(): void {
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
    
    // Remove stale aircraft data
    for (const [callsign, aircraft] of this.systemContext.activeAircraft) {
      if (aircraft.lastUpdate < fiveMinutesAgo) {
        this.systemContext.activeAircraft.delete(callsign);
        this.logger.debug('Removed stale aircraft from context', { callsign });
      }
    }
  }

  private calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const R = 6371; // Earth's radius in kilometers
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLon/2) * Math.sin(dLon/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c;
  }
}
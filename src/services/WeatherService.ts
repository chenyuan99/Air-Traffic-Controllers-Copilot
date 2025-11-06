import { IWeatherService } from '../interfaces/IDataIngestionService';
import { ILogger, IConfigService } from '../interfaces/IService';
import { WeatherData } from '../types';
import { EventEmitter } from '../core/EventEmitter';
import axios from 'axios';

export interface METARData {
  stationId: string;
  observationTime: Date;
  rawText: string;
  temperature: number;
  dewpoint: number;
  windDirection: number;
  windSpeed: number;
  windGust?: number;
  visibility: number;
  altimeter: number;
  seaLevelPressure?: number;
  weatherConditions: WeatherCondition[];
  cloudLayers: CloudLayer[];
  remarks?: string;
}

export interface TAFData {
  stationId: string;
  issueTime: Date;
  validPeriod: { from: Date; to: Date };
  rawText: string;
  forecasts: TAFForecast[];
}

export interface TAFForecast {
  validTime: { from: Date; to: Date };
  changeType: 'FM' | 'TEMPO' | 'PROB' | 'BECMG';
  windDirection: number;
  windSpeed: number;
  windGust?: number;
  visibility: number;
  weatherConditions: WeatherCondition[];
  cloudLayers: CloudLayer[];
  probability?: number;
}

export interface WeatherCondition {
  intensity: 'light' | 'moderate' | 'heavy';
  descriptor?: string;
  precipitation: string[];
  obscuration?: string;
  other?: string;
}

export interface CloudLayer {
  coverage: 'SKC' | 'CLR' | 'FEW' | 'SCT' | 'BKN' | 'OVC';
  altitude: number; // feet AGL
  cloudType?: 'CU' | 'CB' | 'TCU';
}

export interface WeatherImpactAnalysis {
  runwayRecommendations: RunwayRecommendation[];
  operationalImpacts: OperationalImpact[];
  visibilityImpact: VisibilityImpact;
  windImpact: WindImpact;
  precipitationImpact: PrecipitationImpact;
  overallSeverity: 'LOW' | 'MODERATE' | 'HIGH' | 'SEVERE';
}

export interface RunwayRecommendation {
  runway: string;
  suitability: 'PREFERRED' | 'ACCEPTABLE' | 'CAUTION' | 'AVOID';
  reason: string;
  crosswindComponent: number;
  headwindComponent: number;
}

export interface OperationalImpact {
  category: 'DEPARTURE' | 'ARRIVAL' | 'GROUND' | 'APPROACH';
  impact: string;
  severity: 'LOW' | 'MODERATE' | 'HIGH' | 'SEVERE';
  recommendations: string[];
}

export interface VisibilityImpact {
  currentVisibility: number;
  minimumRequired: number;
  impactLevel: 'NONE' | 'MINOR' | 'MODERATE' | 'SEVERE';
  restrictions: string[];
}

export interface WindImpact {
  maxCrosswind: number;
  maxHeadwind: number;
  maxTailwind: number;
  gustFactor: number;
  impactLevel: 'NONE' | 'MINOR' | 'MODERATE' | 'SEVERE';
  affectedRunways: string[];
}

export interface PrecipitationImpact {
  type: string[];
  intensity: 'LIGHT' | 'MODERATE' | 'HEAVY';
  brakingConditions: 'GOOD' | 'FAIR' | 'POOR' | 'NIL';
  visibilityReduction: number;
  recommendations: string[];
}

export class WeatherService implements IWeatherService {
  private logger: ILogger;
  private config: IConfigService;
  private eventEmitter: EventEmitter;
  private currentWeather: WeatherData | null = null;
  private currentMETAR: METARData | null = null;
  private currentTAF: TAFData | null = null;
  private weatherHistory: WeatherData[] = [];
  private subscribers: Array<(weather: WeatherData) => void> = [];
  private updateInterval?: NodeJS.Timer;
  private isInitialized = false;

  // Weather data sources
  private weatherSources = {
    aviationWeather: 'https://aviationweather.gov/api/data',
    noaa: 'https://api.weather.gov',
    openWeather: 'https://api.openweathermap.org/data/2.5'
  };

  constructor(
    logger: ILogger,
    config: IConfigService,
    eventEmitter: EventEmitter
  ) {
    this.logger = logger;
    this.config = config;
    this.eventEmitter = eventEmitter;
  }

  async initialize(): Promise<void> {
    try {
      // Get initial weather data
      await this.fetchCurrentWeather();
      
      // Start periodic weather updates
      this.startPeriodicUpdates();
      
      this.isInitialized = true;
      this.logger.info('Weather Service initialized successfully');
    } catch (error) {
      this.logger.error('Weather Service initialization failed', error as Error);
      throw error;
    }
  }

  async shutdown(): Promise<void> {
    this.isInitialized = false;
    
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
    }
    
    this.subscribers = [];
    this.logger.info('Weather Service shutdown completed');
  }

  async isHealthy(): Promise<boolean> {
    const hasRecentData = this.currentWeather && 
      (Date.now() - this.currentWeather.timestamp.getTime()) < 600000; // 10 minutes
    return this.isInitialized && hasRecentData !== null;
  }

  // Get current weather data
  async getCurrentWeather(): Promise<WeatherData> {
    if (!this.currentWeather || this.isWeatherDataStale()) {
      await this.fetchCurrentWeather();
    }
    
    if (!this.currentWeather) {
      throw new Error('No current weather data available');
    }
    
    return this.currentWeather;
  }

  // Get weather forecast for specified hours ahead
  async getWeatherForecast(hours: number): Promise<WeatherData[]> {
    try {
      const airportCode = this.config.get<string>('airport.code');
      
      // Fetch TAF data if not available or stale
      if (!this.currentTAF || this.isTAFDataStale()) {
        await this.fetchTAFData(airportCode);
      }
      
      if (!this.currentTAF) {
        throw new Error('No TAF data available for forecast');
      }
      
      // Convert TAF forecasts to WeatherData format
      const forecasts = this.convertTAFToWeatherData(this.currentTAF, hours);
      
      this.logger.info('Weather forecast retrieved', {
        airportCode,
        forecastHours: hours,
        forecastCount: forecasts.length
      });
      
      return forecasts;
    } catch (error) {
      this.logger.error('Failed to get weather forecast', error as Error);
      throw error;
    }
  }

  // Subscribe to weather updates
  subscribeToWeatherUpdates(callback: (weather: WeatherData) => void): void {
    this.subscribers.push(callback);
    this.logger.debug('New weather update subscriber added', {
      subscriberCount: this.subscribers.length
    });
  }

  // Analyze weather impact on operations
  async analyzeWeatherImpact(weather: WeatherData): Promise<WeatherImpactAnalysis> {
    try {
      const runways = this.config.get<string[]>('airport.runways');
      
      // Analyze runway conditions
      const runwayRecommendations = this.analyzeRunwayConditions(weather, runways);
      
      // Analyze operational impacts
      const operationalImpacts = this.analyzeOperationalImpacts(weather);
      
      // Analyze visibility impact
      const visibilityImpact = this.analyzeVisibilityImpact(weather);
      
      // Analyze wind impact
      const windImpact = this.analyzeWindImpact(weather, runways);
      
      // Analyze precipitation impact
      const precipitationImpact = this.analyzePrecipitationImpact(weather);
      
      // Determine overall severity
      const overallSeverity = this.determineOverallSeverity([
        visibilityImpact.impactLevel,
        windImpact.impactLevel,
        precipitationImpact.brakingConditions === 'NIL' ? 'SEVERE' : 
        precipitationImpact.brakingConditions === 'POOR' ? 'MODERATE' : 'NONE'
      ]);
      
      const analysis: WeatherImpactAnalysis = {
        runwayRecommendations,
        operationalImpacts,
        visibilityImpact,
        windImpact,
        precipitationImpact,
        overallSeverity
      };
      
      this.logger.info('Weather impact analysis completed', {
        overallSeverity,
        runwayCount: runwayRecommendations.length,
        impactCount: operationalImpacts.length
      });
      
      return analysis;
    } catch (error) {
      this.logger.error('Weather impact analysis failed', error as Error);
      throw error;
    }
  }

  // Get current METAR data
  getCurrentMETAR(): METARData | null {
    return this.currentMETAR;
  }

  // Get current TAF data
  getCurrentTAF(): TAFData | null {
    return this.currentTAF;
  }

  // Get weather history
  getWeatherHistory(hours: number = 24): WeatherData[] {
    const cutoffTime = new Date(Date.now() - (hours * 60 * 60 * 1000));
    return this.weatherHistory.filter(w => w.timestamp >= cutoffTime);
  }

  // Private helper methods
  private async fetchCurrentWeather(): Promise<void> {
    try {
      const airportCode = this.config.get<string>('airport.code');
      
      // Fetch METAR data
      await this.fetchMETARData(airportCode);
      
      if (this.currentMETAR) {
        // Convert METAR to WeatherData format
        this.currentWeather = this.convertMETARToWeatherData(this.currentMETAR);
        
        // Add to history
        this.addToWeatherHistory(this.currentWeather);
        
        // Notify subscribers
        this.notifySubscribers(this.currentWeather);
        
        // Emit weather update event
        this.eventEmitter.emit('weather:updated', {
          weather: this.currentWeather,
          metar: this.currentMETAR
        });
      }
    } catch (error) {
      this.logger.error('Failed to fetch current weather', error as Error);
      throw error;
    }
  }

  private async fetchMETARData(airportCode: string): Promise<void> {
    try {
      // Try Aviation Weather Center first
      const response = await axios.get(
        `${this.weatherSources.aviationWeather}/metar`,
        {
          params: {
            ids: airportCode,
            format: 'json',
            taf: false,
            hours: 1
          },
          timeout: 10000
        }
      );
      
      if (response.data && response.data.length > 0) {
        const metarData = response.data[0];
        this.currentMETAR = this.parseMETARData(metarData);
        
        this.logger.debug('METAR data fetched successfully', {
          airportCode,
          observationTime: this.currentMETAR.observationTime
        });
      } else {
        throw new Error('No METAR data received');
      }
    } catch (error) {
      this.logger.error('Failed to fetch METAR data', error as Error);
      
      // Try fallback source or use simulated data
      this.currentMETAR = this.generateSimulatedMETAR(airportCode);
    }
  }

  private async fetchTAFData(airportCode: string): Promise<void> {
    try {
      const response = await axios.get(
        `${this.weatherSources.aviationWeather}/taf`,
        {
          params: {
            ids: airportCode,
            format: 'json',
            hours: 30
          },
          timeout: 10000
        }
      );
      
      if (response.data && response.data.length > 0) {
        const tafData = response.data[0];
        this.currentTAF = this.parseTAFData(tafData);
        
        this.logger.debug('TAF data fetched successfully', {
          airportCode,
          issueTime: this.currentTAF.issueTime,
          forecastCount: this.currentTAF.forecasts.length
        });
      }
    } catch (error) {
      this.logger.error('Failed to fetch TAF data', error as Error);
      
      // Generate simulated TAF data
      this.currentTAF = this.generateSimulatedTAF(airportCode);
    }
  }

  private parseMETARData(rawData: any): METARData {
    // Simplified METAR parsing - real implementation would use proper METAR decoder
    return {
      stationId: rawData.icaoId || 'KEWR',
      observationTime: new Date(rawData.reportTime || Date.now()),
      rawText: rawData.rawOb || '',
      temperature: rawData.temp || 15,
      dewpoint: rawData.dewp || 10,
      windDirection: rawData.wdir || 270,
      windSpeed: rawData.wspd || 10,
      windGust: rawData.wgst,
      visibility: rawData.visib || 10,
      altimeter: rawData.altim || 30.12,
      seaLevelPressure: rawData.slp,
      weatherConditions: this.parseWeatherConditions(rawData.wxString || ''),
      cloudLayers: this.parseCloudLayers(rawData.clds || []),
      remarks: rawData.rmk
    };
  }

  private parseTAFData(rawData: any): TAFData {
    // Simplified TAF parsing
    return {
      stationId: rawData.icaoId || 'KEWR',
      issueTime: new Date(rawData.bulletinTime || Date.now()),
      validPeriod: {
        from: new Date(rawData.validTimeFrom || Date.now()),
        to: new Date(rawData.validTimeTo || Date.now() + 24 * 60 * 60 * 1000)
      },
      rawText: rawData.rawTAF || '',
      forecasts: this.parseTAFForecasts(rawData.forecasts || [])
    };
  }

  private parseWeatherConditions(wxString: string): WeatherCondition[] {
    // Simplified weather condition parsing
    const conditions: WeatherCondition[] = [];
    
    if (wxString.includes('RA')) {
      conditions.push({
        intensity: wxString.includes('-') ? 'light' : wxString.includes('+') ? 'heavy' : 'moderate',
        precipitation: ['rain']
      });
    }
    
    if (wxString.includes('SN')) {
      conditions.push({
        intensity: wxString.includes('-') ? 'light' : wxString.includes('+') ? 'heavy' : 'moderate',
        precipitation: ['snow']
      });
    }
    
    return conditions;
  }

  private parseCloudLayers(cloudData: any[]): CloudLayer[] {
    return cloudData.map(cloud => ({
      coverage: cloud.cover || 'CLR',
      altitude: cloud.base || 0,
      cloudType: cloud.type
    }));
  }

  private parseTAFForecasts(forecastData: any[]): TAFForecast[] {
    return forecastData.map(forecast => ({
      validTime: {
        from: new Date(forecast.fcstTimeFrom || Date.now()),
        to: new Date(forecast.fcstTimeTo || Date.now() + 6 * 60 * 60 * 1000)
      },
      changeType: forecast.changeIndicator || 'FM',
      windDirection: forecast.wdir || 270,
      windSpeed: forecast.wspd || 10,
      windGust: forecast.wgst,
      visibility: forecast.visib || 10,
      weatherConditions: this.parseWeatherConditions(forecast.wxString || ''),
      cloudLayers: this.parseCloudLayers(forecast.clds || []),
      probability: forecast.prob
    }));
  }

  private convertMETARToWeatherData(metar: METARData): WeatherData {
    return {
      timestamp: metar.observationTime,
      temperature: metar.temperature,
      windSpeed: metar.windSpeed,
      windDirection: metar.windDirection,
      visibility: metar.visibility,
      ceiling: this.getLowestCeiling(metar.cloudLayers),
      precipitation: this.getPrecipitationString(metar.weatherConditions),
      pressure: metar.altimeter
    };
  }

  private convertTAFToWeatherData(taf: TAFData, hours: number): WeatherData[] {
    const forecasts: WeatherData[] = [];
    const endTime = new Date(Date.now() + hours * 60 * 60 * 1000);
    
    for (const forecast of taf.forecasts) {
      if (forecast.validTime.from <= endTime) {
        forecasts.push({
          timestamp: forecast.validTime.from,
          temperature: 15, // TAF doesn't include temperature
          windSpeed: forecast.windSpeed,
          windDirection: forecast.windDirection,
          visibility: forecast.visibility,
          ceiling: this.getLowestCeiling(forecast.cloudLayers),
          precipitation: this.getPrecipitationString(forecast.weatherConditions),
          pressure: 30.12 // Default pressure
        });
      }
    }
    
    return forecasts;
  }

  private analyzeRunwayConditions(weather: WeatherData, runways: string[]): RunwayRecommendation[] {
    const recommendations: RunwayRecommendation[] = [];
    
    for (const runway of runways) {
      const runwayHeading = this.getRunwayHeading(runway);
      const windComponents = this.calculateWindComponents(
        weather.windDirection,
        weather.windSpeed,
        runwayHeading
      );
      
      let suitability: RunwayRecommendation['suitability'] = 'PREFERRED';
      let reason = 'Favorable wind conditions';
      
      // Check crosswind limits
      if (Math.abs(windComponents.crosswind) > 25) {
        suitability = 'AVOID';
        reason = 'Excessive crosswind component';
      } else if (Math.abs(windComponents.crosswind) > 15) {
        suitability = 'CAUTION';
        reason = 'High crosswind component';
      } else if (Math.abs(windComponents.crosswind) > 10) {
        suitability = 'ACCEPTABLE';
        reason = 'Moderate crosswind component';
      }
      
      // Check tailwind
      if (windComponents.headwind < -10) {
        suitability = 'CAUTION';
        reason = 'Tailwind component present';
      }
      
      recommendations.push({
        runway,
        suitability,
        reason,
        crosswindComponent: windComponents.crosswind,
        headwindComponent: windComponents.headwind
      });
    }
    
    return recommendations;
  }

  private analyzeOperationalImpacts(weather: WeatherData): OperationalImpact[] {
    const impacts: OperationalImpact[] = [];
    
    // Visibility impacts
    if (weather.visibility < 3) {
      impacts.push({
        category: 'APPROACH',
        impact: 'Reduced visibility may require ILS approaches',
        severity: weather.visibility < 1 ? 'SEVERE' : 'MODERATE',
        recommendations: ['Use precision approaches', 'Increase separation']
      });
    }
    
    // Wind impacts
    if (weather.windSpeed > 25) {
      impacts.push({
        category: 'DEPARTURE',
        impact: 'Strong winds may affect takeoff performance',
        severity: weather.windSpeed > 35 ? 'SEVERE' : 'HIGH',
        recommendations: ['Monitor crosswind limits', 'Consider runway changes']
      });
    }
    
    // Precipitation impacts
    if (weather.precipitation && weather.precipitation !== 'none') {
      impacts.push({
        category: 'GROUND',
        impact: 'Precipitation may affect ground operations',
        severity: 'MODERATE',
        recommendations: ['Monitor braking conditions', 'Increase taxi speeds caution']
      });
    }
    
    return impacts;
  }

  private analyzeVisibilityImpact(weather: WeatherData): VisibilityImpact {
    const minimumRequired = 3; // statute miles for VFR
    
    let impactLevel: VisibilityImpact['impactLevel'] = 'NONE';
    const restrictions: string[] = [];
    
    if (weather.visibility < minimumRequired) {
      if (weather.visibility < 1) {
        impactLevel = 'SEVERE';
        restrictions.push('IFR conditions only', 'CAT II/III approaches may be required');
      } else if (weather.visibility < 2) {
        impactLevel = 'MODERATE';
        restrictions.push('IFR approaches required', 'Increased separation');
      } else {
        impactLevel = 'MINOR';
        restrictions.push('Monitor visibility closely');
      }
    }
    
    return {
      currentVisibility: weather.visibility,
      minimumRequired,
      impactLevel,
      restrictions
    };
  }

  private analyzeWindImpact(weather: WeatherData, runways: string[]): WindImpact {
    let maxCrosswind = 0;
    let maxHeadwind = 0;
    let maxTailwind = 0;
    const affectedRunways: string[] = [];
    
    for (const runway of runways) {
      const runwayHeading = this.getRunwayHeading(runway);
      const components = this.calculateWindComponents(
        weather.windDirection,
        weather.windSpeed,
        runwayHeading
      );
      
      maxCrosswind = Math.max(maxCrosswind, Math.abs(components.crosswind));
      maxHeadwind = Math.max(maxHeadwind, components.headwind);
      maxTailwind = Math.min(maxTailwind, components.headwind);
      
      if (Math.abs(components.crosswind) > 15 || components.headwind < -10) {
        affectedRunways.push(runway);
      }
    }
    
    let impactLevel: WindImpact['impactLevel'] = 'NONE';
    if (maxCrosswind > 25 || maxTailwind < -15) {
      impactLevel = 'SEVERE';
    } else if (maxCrosswind > 15 || maxTailwind < -10) {
      impactLevel = 'MODERATE';
    } else if (maxCrosswind > 10) {
      impactLevel = 'MINOR';
    }
    
    return {
      maxCrosswind,
      maxHeadwind,
      maxTailwind,
      gustFactor: weather.windSpeed * 0.2, // Simplified gust factor
      impactLevel,
      affectedRunways
    };
  }

  private analyzePrecipitationImpact(weather: WeatherData): PrecipitationImpact {
    const precipitation = weather.precipitation || 'none';
    const type: string[] = [];
    let intensity: PrecipitationImpact['intensity'] = 'LIGHT';
    let brakingConditions: PrecipitationImpact['brakingConditions'] = 'GOOD';
    let visibilityReduction = 0;
    const recommendations: string[] = [];
    
    if (precipitation !== 'none') {
      if (precipitation.includes('rain')) {
        type.push('rain');
        brakingConditions = 'FAIR';
        visibilityReduction = 1;
        recommendations.push('Monitor runway conditions', 'Consider braking action reports');
      }
      
      if (precipitation.includes('snow')) {
        type.push('snow');
        brakingConditions = 'POOR';
        visibilityReduction = 2;
        recommendations.push('Snow removal operations may be required', 'Monitor accumulation');
      }
      
      if (precipitation.includes('heavy')) {
        intensity = 'HEAVY';
        brakingConditions = 'NIL';
        visibilityReduction += 2;
        recommendations.push('Consider ground stop', 'Runway may become unusable');
      }
    }
    
    return {
      type,
      intensity,
      brakingConditions,
      visibilityReduction,
      recommendations
    };
  }

  private determineOverallSeverity(impacts: string[]): 'LOW' | 'MODERATE' | 'HIGH' | 'SEVERE' {
    if (impacts.includes('SEVERE')) return 'SEVERE';
    if (impacts.includes('HIGH')) return 'HIGH';
    if (impacts.includes('MODERATE')) return 'MODERATE';
    return 'LOW';
  }

  private getRunwayHeading(runway: string): number {
    // Extract heading from runway identifier (e.g., "04L" -> 040 degrees)
    const numericPart = runway.replace(/[LRC]/g, '');
    return parseInt(numericPart) * 10;
  }

  private calculateWindComponents(windDir: number, windSpeed: number, runwayHeading: number): {
    headwind: number;
    crosswind: number;
  } {
    const angleDiff = windDir - runwayHeading;
    const angleRad = (angleDiff * Math.PI) / 180;
    
    return {
      headwind: windSpeed * Math.cos(angleRad),
      crosswind: windSpeed * Math.sin(angleRad)
    };
  }

  private getLowestCeiling(cloudLayers: CloudLayer[]): number | undefined {
    const ceilingLayers = cloudLayers.filter(layer => 
      layer.coverage === 'BKN' || layer.coverage === 'OVC'
    );
    
    if (ceilingLayers.length === 0) return undefined;
    
    return Math.min(...ceilingLayers.map(layer => layer.altitude));
  }

  private getPrecipitationString(conditions: WeatherCondition[]): string {
    if (conditions.length === 0) return 'none';
    
    const precipTypes = conditions.flatMap(c => c.precipitation);
    return precipTypes.join(', ');
  }

  private generateSimulatedMETAR(airportCode: string): METARData {
    // Generate realistic simulated METAR data for testing
    return {
      stationId: airportCode,
      observationTime: new Date(),
      rawText: `${airportCode} ${new Date().toISOString().slice(11, 16)}Z AUTO 27010KT 10SM CLR 15/10 A3012 RMK AO2`,
      temperature: 15 + (Math.random() * 20 - 10),
      dewpoint: 10 + (Math.random() * 10 - 5),
      windDirection: 270 + (Math.random() * 60 - 30),
      windSpeed: 10 + (Math.random() * 15),
      visibility: 10,
      altimeter: 30.12 + (Math.random() * 0.5 - 0.25),
      weatherConditions: [],
      cloudLayers: [{ coverage: 'CLR', altitude: 0 }]
    };
  }

  private generateSimulatedTAF(airportCode: string): TAFData {
    const now = new Date();
    const validFrom = new Date(now.getTime() + 60 * 60 * 1000); // 1 hour from now
    const validTo = new Date(now.getTime() + 24 * 60 * 60 * 1000); // 24 hours from now
    
    return {
      stationId: airportCode,
      issueTime: now,
      validPeriod: { from: validFrom, to: validTo },
      rawText: `TAF ${airportCode} ${now.toISOString().slice(8, 16)}Z 27010KT 9999 FEW250`,
      forecasts: [{
        validTime: { from: validFrom, to: validTo },
        changeType: 'FM',
        windDirection: 270,
        windSpeed: 10,
        visibility: 10,
        weatherConditions: [],
        cloudLayers: [{ coverage: 'FEW', altitude: 25000 }]
      }]
    };
  }

  private isWeatherDataStale(): boolean {
    if (!this.currentWeather) return true;
    const ageMinutes = (Date.now() - this.currentWeather.timestamp.getTime()) / (1000 * 60);
    return ageMinutes > 10; // Consider stale after 10 minutes
  }

  private isTAFDataStale(): boolean {
    if (!this.currentTAF) return true;
    const ageHours = (Date.now() - this.currentTAF.issueTime.getTime()) / (1000 * 60 * 60);
    return ageHours > 6; // TAF is typically issued every 6 hours
  }

  private startPeriodicUpdates(): void {
    // Update weather every 5 minutes
    this.updateInterval = setInterval(async () => {
      try {
        await this.fetchCurrentWeather();
      } catch (error) {
        this.logger.error('Periodic weather update failed', error as Error);
      }
    }, 5 * 60 * 1000);
  }

  private addToWeatherHistory(weather: WeatherData): void {
    this.weatherHistory.push(weather);
    
    // Keep only last 48 hours of history
    const cutoffTime = new Date(Date.now() - 48 * 60 * 60 * 1000);
    this.weatherHistory = this.weatherHistory.filter(w => w.timestamp >= cutoffTime);
  }

  private notifySubscribers(weather: WeatherData): void {
    for (const callback of this.subscribers) {
      try {
        callback(weather);
      } catch (error) {
        this.logger.error('Weather subscriber callback failed', error as Error);
      }
    }
  }
}
import { IService, ILogger, IConfigService } from '../interfaces/IService';
import { EventEmitter } from '../core/EventEmitter';
import axios from 'axios';

export interface NEXRADData {
  stationId: string;
  timestamp: Date;
  elevationAngle: number;
  azimuthAngle: number;
  range: number;
  reflectivity: number[][]; // dBZ values in polar coordinates
  velocity: number[][]; // m/s values in polar coordinates
  spectrumWidth: number[][]; // m/s values
  volumeCoveragePattern: number;
  scanStrategy: string;
}

export interface RadarSweep {
  elevationAngle: number;
  azimuthStart: number;
  azimuthEnd: number;
  rangeGates: number;
  gateSpacing: number; // meters
  data: RadarGate[];
}

export interface RadarGate {
  azimuth: number;
  range: number;
  reflectivity: number; // dBZ
  velocity: number; // m/s
  spectrumWidth: number; // m/s
  latitude: number;
  longitude: number;
}

export interface WeatherCell {
  id: string;
  centerLat: number;
  centerLon: number;
  maxReflectivity: number;
  area: number; // square kilometers
  movement: { direction: number; speed: number };
  intensity: 'LIGHT' | 'MODERATE' | 'HEAVY' | 'EXTREME';
  type: 'RAIN' | 'SNOW' | 'HAIL' | 'MIXED';
  tops: number; // feet MSL
  trend: 'INCREASING' | 'DECREASING' | 'STEADY';
  timestamp: Date;
}

export interface PrecipitationForecast {
  location: { lat: number; lon: number };
  timeToArrival: number; // minutes
  intensity: number; // dBZ
  duration: number; // minutes
  confidence: number; // 0-1
  type: 'RAIN' | 'SNOW' | 'HAIL';
}

export interface RadarSite {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  elevation: number; // meters MSL
  range: number; // kilometers
  isOperational: boolean;
  lastUpdate: Date;
}

export class NEXRADProcessor implements IService {
  private logger: ILogger;
  private config: IConfigService;
  private eventEmitter: EventEmitter;
  private radarSites = new Map<string, RadarSite>();
  private currentRadarData = new Map<string, NEXRADData>();
  private weatherCells: WeatherCell[] = [];
  private precipitationForecasts: PrecipitationForecast[] = [];
  private isProcessing = false;
  private updateInterval?: NodeJS.Timer;

  // NEXRAD Level II data URLs
  private nexradSources = {
    aws: 'https://noaa-nexrad-level2.s3.amazonaws.com',
    ncei: 'https://www.ncei.noaa.gov/data/nexrad-level-2',
    realtime: 'https://nomads.ncep.noaa.gov/pub/data/nccf/radar/nexrad_level2'
  };

  constructor(
    logger: ILogger,
    config: IConfigService,
    eventEmitter: EventEmitter
  ) {
    this.logger = logger;
    this.config = config;
    this.eventEmitter = eventEmitter;
    this.initializeRadarSites();
  }

  async initialize(): Promise<void> {
    try {
      await this.loadNearbyRadarSites();
      await this.fetchInitialRadarData();
      this.startPeriodicUpdates();
      this.isProcessing = true;
      this.logger.info('NEXRAD Processor initialized successfully');
    } catch (error) {
      this.logger.error('NEXRAD Processor initialization failed', error as Error);
      throw error;
    }
  }

  async shutdown(): Promise<void> {
    this.isProcessing = false;
    
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
    }
    
    this.currentRadarData.clear();
    this.weatherCells = [];
    this.precipitationForecasts = [];
    
    this.logger.info('NEXRAD Processor shutdown completed');
  }

  async isHealthy(): Promise<boolean> {
    const operationalSites = Array.from(this.radarSites.values()).filter(s => s.isOperational);
    const recentData = Array.from(this.currentRadarData.values()).some(data => 
      (Date.now() - data.timestamp.getTime()) < 600000 // 10 minutes
    );
    return this.isProcessing && operationalSites.length > 0 && recentData;
  }

  // Process NEXRAD Level II data
  async processNEXRADData(radarSiteId: string, rawData: Buffer): Promise<NEXRADData> {
    try {
      const startTime = Date.now();
      
      // Parse NEXRAD Level II data format
      const nexradData = await this.parseLevel2Data(rawData, radarSiteId);
      
      // Store current data
      this.currentRadarData.set(radarSiteId, nexradData);
      
      // Extract weather cells
      const cells = this.extractWeatherCells(nexradData);
      this.updateWeatherCells(cells);
      
      // Generate precipitation forecasts
      const forecasts = this.generatePrecipitationForecasts(nexradData);
      this.updatePrecipitationForecasts(forecasts);
      
      const processingTime = Date.now() - startTime;
      
      this.logger.info('NEXRAD data processed successfully', {
        radarSiteId,
        processingTime,
        cellCount: cells.length,
        forecastCount: forecasts.length
      });
      
      // Emit radar data event
      this.eventEmitter.emit('nexrad:data_processed', {
        radarSiteId,
        data: nexradData,
        weatherCells: cells,
        forecasts
      });
      
      return nexradData;
    } catch (error) {
      this.logger.error('NEXRAD data processing failed', error as Error, { radarSiteId });
      throw error;
    }
  }

  // Get current weather cells
  getCurrentWeatherCells(): WeatherCell[] {
    return [...this.weatherCells];
  }

  // Get precipitation forecasts for airport area
  getPrecipitationForecasts(airportLat: number, airportLon: number, radiusKm: number = 50): PrecipitationForecast[] {
    return this.precipitationForecasts.filter(forecast => {
      const distance = this.calculateDistance(
        airportLat, airportLon,
        forecast.location.lat, forecast.location.lon
      );
      return distance <= radiusKm;
    });
  }

  // Get radar data for specific site
  getRadarData(radarSiteId: string): NEXRADData | null {
    return this.currentRadarData.get(radarSiteId) || null;
  }

  // Get nearby radar sites
  getNearbyRadarSites(lat: number, lon: number, maxDistanceKm: number = 200): RadarSite[] {
    return Array.from(this.radarSites.values()).filter(site => {
      const distance = this.calculateDistance(lat, lon, site.latitude, site.longitude);
      return distance <= maxDistanceKm;
    });
  }

  // Analyze precipitation intensity at specific location
  analyzePrecipitationAtLocation(lat: number, lon: number): {
    currentIntensity: number;
    trend: 'INCREASING' | 'DECREASING' | 'STEADY';
    timeToArrival?: number;
    duration?: number;
  } {
    // Find nearest radar data
    const nearestSite = this.findNearestRadarSite(lat, lon);
    if (!nearestSite) {
      return { currentIntensity: 0, trend: 'STEADY' };
    }
    
    const radarData = this.currentRadarData.get(nearestSite.id);
    if (!radarData) {
      return { currentIntensity: 0, trend: 'STEADY' };
    }
    
    // Convert lat/lon to radar coordinates
    const radarCoords = this.latLonToRadarCoords(lat, lon, nearestSite);
    
    // Extract reflectivity at location
    const intensity = this.getReflectivityAtCoords(radarData, radarCoords);
    
    // Analyze trend (simplified)
    const trend = this.analyzeTrend(lat, lon);
    
    // Check forecasts for this location
    const forecast = this.precipitationForecasts.find(f => 
      this.calculateDistance(lat, lon, f.location.lat, f.location.lon) < 5
    );
    
    return {
      currentIntensity: intensity,
      trend,
      timeToArrival: forecast?.timeToArrival,
      duration: forecast?.duration
    };
  }

  // Get composite reflectivity for area
  getCompositeReflectivity(bounds: {
    north: number;
    south: number;
    east: number;
    west: number;
  }): number[][] {
    // Create composite from all available radar sites
    const gridSize = 100; // 100x100 grid
    const composite: number[][] = Array(gridSize).fill(null).map(() => Array(gridSize).fill(-999));
    
    const latStep = (bounds.north - bounds.south) / gridSize;
    const lonStep = (bounds.east - bounds.west) / gridSize;
    
    for (let i = 0; i < gridSize; i++) {
      for (let j = 0; j < gridSize; j++) {
        const lat = bounds.south + (i * latStep);
        const lon = bounds.west + (j * lonStep);
        
        const analysis = this.analyzePrecipitationAtLocation(lat, lon);
        composite[i][j] = analysis.currentIntensity;
      }
    }
    
    return composite;
  }

  // Private helper methods
  private initializeRadarSites(): void {
    // Initialize major NEXRAD sites near EWR
    this.radarSites.set('KOKX', {
      id: 'KOKX',
      name: 'New York (Upton)',
      latitude: 40.8656,
      longitude: -72.8644,
      elevation: 26,
      range: 460, // kilometers
      isOperational: true,
      lastUpdate: new Date()
    });
    
    this.radarSites.set('KDIX', {
      id: 'KDIX',
      name: 'Philadelphia (Mount Holly)',
      latitude: 39.9469,
      longitude: -74.4111,
      elevation: 45,
      range: 460,
      isOperational: true,
      lastUpdate: new Date()
    });
    
    this.radarSites.set('KENX', {
      id: 'KENX',
      name: 'Albany',
      latitude: 42.5864,
      longitude: -74.0639,
      elevation: 557,
      range: 460,
      isOperational: true,
      lastUpdate: new Date()
    });
  }

  private async loadNearbyRadarSites(): Promise<void> {
    // In real implementation, this would load from NEXRAD site database
    this.logger.info('Loaded NEXRAD radar sites', {
      siteCount: this.radarSites.size,
      sites: Array.from(this.radarSites.keys())
    });
  }

  private async fetchInitialRadarData(): Promise<void> {
    // Fetch initial radar data for all sites
    for (const [siteId, site] of this.radarSites) {
      try {
        await this.fetchRadarDataForSite(siteId);
      } catch (error) {
        this.logger.warn(`Failed to fetch initial data for radar site ${siteId}`, {
          error: (error as Error).message
        });
      }
    }
  }

  private async fetchRadarDataForSite(siteId: string): Promise<void> {
    try {
      // In real implementation, this would fetch actual NEXRAD Level II data
      // For simulation, generate synthetic radar data
      const syntheticData = this.generateSyntheticRadarData(siteId);
      await this.processNEXRADData(siteId, Buffer.from('synthetic'));
      
      this.logger.debug(`Fetched radar data for site ${siteId}`);
    } catch (error) {
      this.logger.error(`Failed to fetch radar data for site ${siteId}`, error as Error);
    }
  }

  private async parseLevel2Data(rawData: Buffer, radarSiteId: string): Promise<NEXRADData> {
    // Simplified NEXRAD Level II parsing
    // Real implementation would use proper NEXRAD decoder
    
    const site = this.radarSites.get(radarSiteId);
    if (!site) {
      throw new Error(`Unknown radar site: ${radarSiteId}`);
    }
    
    // Generate synthetic data for demonstration
    const reflectivity: number[][] = [];
    const velocity: number[][] = [];
    const spectrumWidth: number[][] = [];
    
    const azimuths = 360; // 360 azimuth angles
    const ranges = 460; // 460 km range
    
    for (let az = 0; az < azimuths; az++) {
      const reflectivityRow: number[] = [];
      const velocityRow: number[] = [];
      const spectrumWidthRow: number[] = [];
      
      for (let r = 0; r < ranges; r++) {
        // Generate realistic weather patterns
        const distance = r; // km
        const azimuth = az; // degrees
        
        // Simulate weather cells
        let reflectivity_dBZ = -999; // No data
        let velocity_ms = 0;
        let spectrum_ms = 0;
        
        // Add some weather cells
        if (this.isInWeatherCell(azimuth, distance)) {
          reflectivity_dBZ = 20 + (Math.random() * 40); // 20-60 dBZ
          velocity_ms = -10 + (Math.random() * 20); // -10 to +10 m/s
          spectrum_ms = 1 + (Math.random() * 3); // 1-4 m/s
        }
        
        reflectivityRow.push(reflectivity_dBZ);
        velocityRow.push(velocity_ms);
        spectrumWidthRow.push(spectrum_ms);
      }
      
      reflectivity.push(reflectivityRow);
      velocity.push(velocityRow);
      spectrumWidth.push(spectrumWidthRow);
    }
    
    return {
      stationId: radarSiteId,
      timestamp: new Date(),
      elevationAngle: 0.5, // degrees
      azimuthAngle: 0,
      range: ranges,
      reflectivity,
      velocity,
      spectrumWidth,
      volumeCoveragePattern: 21,
      scanStrategy: 'Clear Air'
    };
  }

  private extractWeatherCells(radarData: NEXRADData): WeatherCell[] {
    const cells: WeatherCell[] = [];
    const site = this.radarSites.get(radarData.stationId);
    if (!site) return cells;
    
    // Simplified cell detection algorithm
    const threshold = 30; // dBZ threshold for significant weather
    
    for (let az = 0; az < radarData.reflectivity.length; az += 10) {
      for (let r = 10; r < radarData.reflectivity[az].length; r += 10) {
        const reflectivity = radarData.reflectivity[az][r];
        
        if (reflectivity > threshold) {
          // Convert radar coordinates to lat/lon
          const coords = this.radarCoordsToLatLon(az, r, site);
          
          cells.push({
            id: `cell_${radarData.stationId}_${az}_${r}`,
            centerLat: coords.lat,
            centerLon: coords.lon,
            maxReflectivity: reflectivity,
            area: 25, // km²
            movement: { direction: 270, speed: 15 }, // km/h
            intensity: this.classifyIntensity(reflectivity),
            type: 'RAIN',
            tops: 30000, // feet
            trend: 'STEADY',
            timestamp: radarData.timestamp
          });
        }
      }
    }
    
    return cells;
  }

  private generatePrecipitationForecasts(radarData: NEXRADData): PrecipitationForecast[] {
    const forecasts: PrecipitationForecast[] = [];
    const site = this.radarSites.get(radarData.stationId);
    if (!site) return forecasts;
    
    // Generate forecasts based on current weather cells and movement
    for (const cell of this.weatherCells) {
      if (cell.maxReflectivity > 20) {
        // Project cell movement
        const movementVector = this.calculateMovementVector(cell);
        
        for (let t = 15; t <= 120; t += 15) { // 15 minute intervals up to 2 hours
          const futurePosition = this.projectPosition(cell, movementVector, t);
          
          forecasts.push({
            location: futurePosition,
            timeToArrival: t,
            intensity: cell.maxReflectivity * 0.9, // Slight decay
            duration: 30, // minutes
            confidence: Math.max(0.1, 0.9 - (t / 120) * 0.4), // Decreasing confidence
            type: cell.type as 'RAIN' | 'SNOW' | 'HAIL'
          });
        }
      }
    }
    
    return forecasts;
  }

  private updateWeatherCells(newCells: WeatherCell[]): void {
    // Update existing cells or add new ones
    this.weatherCells = newCells;
    
    // Remove cells older than 30 minutes
    const cutoffTime = new Date(Date.now() - 30 * 60 * 1000);
    this.weatherCells = this.weatherCells.filter(cell => cell.timestamp >= cutoffTime);
  }

  private updatePrecipitationForecasts(newForecasts: PrecipitationForecast[]): void {
    this.precipitationForecasts = newForecasts;
  }

  private generateSyntheticRadarData(siteId: string): NEXRADData {
    // Generate synthetic radar data for testing
    return {
      stationId: siteId,
      timestamp: new Date(),
      elevationAngle: 0.5,
      azimuthAngle: 0,
      range: 460,
      reflectivity: [],
      velocity: [],
      spectrumWidth: [],
      volumeCoveragePattern: 21,
      scanStrategy: 'Clear Air'
    };
  }

  private isInWeatherCell(azimuth: number, distance: number): boolean {
    // Simulate some weather cells for testing
    return (azimuth >= 45 && azimuth <= 90 && distance >= 50 && distance <= 100) ||
           (azimuth >= 180 && azimuth <= 225 && distance >= 75 && distance <= 150);
  }

  private classifyIntensity(reflectivity: number): 'LIGHT' | 'MODERATE' | 'HEAVY' | 'EXTREME' {
    if (reflectivity < 20) return 'LIGHT';
    if (reflectivity < 40) return 'MODERATE';
    if (reflectivity < 55) return 'HEAVY';
    return 'EXTREME';
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

  private findNearestRadarSite(lat: number, lon: number): RadarSite | null {
    let nearest: RadarSite | null = null;
    let minDistance = Infinity;
    
    for (const site of this.radarSites.values()) {
      const distance = this.calculateDistance(lat, lon, site.latitude, site.longitude);
      if (distance < minDistance) {
        minDistance = distance;
        nearest = site;
      }
    }
    
    return nearest;
  }

  private latLonToRadarCoords(lat: number, lon: number, site: RadarSite): { azimuth: number; range: number } {
    const dLat = lat - site.latitude;
    const dLon = lon - site.longitude;
    
    const azimuth = Math.atan2(dLon, dLat) * 180 / Math.PI;
    const range = this.calculateDistance(lat, lon, site.latitude, site.longitude);
    
    return { azimuth: (azimuth + 360) % 360, range };
  }

  private radarCoordsToLatLon(azimuth: number, range: number, site: RadarSite): { lat: number; lon: number } {
    const R = 6371; // Earth's radius in km
    const bearing = azimuth * Math.PI / 180;
    const lat1 = site.latitude * Math.PI / 180;
    const lon1 = site.longitude * Math.PI / 180;
    
    const lat2 = Math.asin(Math.sin(lat1) * Math.cos(range / R) +
                          Math.cos(lat1) * Math.sin(range / R) * Math.cos(bearing));
    
    const lon2 = lon1 + Math.atan2(Math.sin(bearing) * Math.sin(range / R) * Math.cos(lat1),
                                   Math.cos(range / R) - Math.sin(lat1) * Math.sin(lat2));
    
    return {
      lat: lat2 * 180 / Math.PI,
      lon: lon2 * 180 / Math.PI
    };
  }

  private getReflectivityAtCoords(radarData: NEXRADData, coords: { azimuth: number; range: number }): number {
    const azIndex = Math.round(coords.azimuth);
    const rangeIndex = Math.round(coords.range);
    
    if (azIndex >= 0 && azIndex < radarData.reflectivity.length &&
        rangeIndex >= 0 && rangeIndex < radarData.reflectivity[azIndex].length) {
      return radarData.reflectivity[azIndex][rangeIndex];
    }
    
    return -999; // No data
  }

  private analyzeTrend(lat: number, lon: number): 'INCREASING' | 'DECREASING' | 'STEADY' {
    // Simplified trend analysis
    // Real implementation would compare historical data
    return 'STEADY';
  }

  private calculateMovementVector(cell: WeatherCell): { dx: number; dy: number } {
    const speed = cell.movement.speed; // km/h
    const direction = cell.movement.direction * Math.PI / 180; // radians
    
    return {
      dx: speed * Math.sin(direction),
      dy: speed * Math.cos(direction)
    };
  }

  private projectPosition(cell: WeatherCell, movement: { dx: number; dy: number }, minutes: number): { lat: number; lon: number } {
    const hours = minutes / 60;
    const deltaLat = (movement.dy * hours) / 111; // Approximate km to degrees
    const deltaLon = (movement.dx * hours) / (111 * Math.cos(cell.centerLat * Math.PI / 180));
    
    return {
      lat: cell.centerLat + deltaLat,
      lon: cell.centerLon + deltaLon
    };
  }

  private startPeriodicUpdates(): void {
    // Update radar data every 5 minutes
    this.updateInterval = setInterval(async () => {
      for (const siteId of this.radarSites.keys()) {
        try {
          await this.fetchRadarDataForSite(siteId);
        } catch (error) {
          this.logger.error(`Periodic radar update failed for ${siteId}`, error as Error);
        }
      }
    }, 5 * 60 * 1000);
  }
}
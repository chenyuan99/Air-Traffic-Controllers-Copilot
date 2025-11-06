import { IRadarDataProcessor } from '../interfaces/IDataIngestionService';
import { ILogger, IConfigService } from '../interfaces/IService';
import { Aircraft, Position3D, Vector3D, AircraftStatus } from '../types';
import { EventEmitter } from '../core/EventEmitter';

export interface AsterixMessage {
  category: number;
  length: number;
  dataSourceId: number;
  timestamp: Date;
  data: AsterixDataBlock[];
}

export interface AsterixDataBlock {
  itemId: number;
  data: Buffer;
  decoded?: any;
}

export interface RadarTrack {
  trackNumber: number;
  callsign?: string;
  position: Position3D;
  velocity: Vector3D;
  heading: number;
  squawkCode?: string;
  mode3A?: string;
  flightLevel?: number;
  groundSpeed?: number;
  lastUpdate: Date;
  trackQuality: TrackQuality;
}

export interface TrackQuality {
  confidence: number;
  positionAccuracy: number;
  velocityAccuracy: number;
  ageSeconds: number;
  sourceReliability: number;
}

export interface RadarSite {
  id: string;
  name: string;
  position: Position3D;
  range: number;
  isActive: boolean;
  lastHeartbeat: Date;
}

export class RadarDataProcessor implements IRadarDataProcessor {
  private logger: ILogger;
  private config: IConfigService;
  private eventEmitter: EventEmitter;
  private isProcessing = false;
  private radarTracks = new Map<number, RadarTrack>();
  private aircraftMap = new Map<string, Aircraft>();
  private radarSites = new Map<string, RadarSite>();
  private subscribers: Array<(aircraft: Aircraft[]) => void> = [];
  private processingStats = {
    messagesProcessed: 0,
    tracksActive: 0,
    lastProcessingTime: 0,
    errorCount: 0
  };

  // ASTERIX Category 048 (Monoradar Target Reports) field definitions
  private asterixFields = new Map([
    [0x010, { name: 'Data Source Identifier', length: 2 }],
    [0x020, { name: 'Target Report Descriptor', length: 1 }],
    [0x040, { name: 'Measured Position in Polar Coordinates', length: 4 }],
    [0x070, { name: 'Mode-3/A Code in Octal Representation', length: 2 }],
    [0x090, { name: 'Flight Level in Binary Representation', length: 2 }],
    [0x130, { name: 'Radar Plot Characteristics', length: 1 }],
    [0x220, { name: 'Aircraft Address', length: 3 }],
    [0x240, { name: 'Aircraft Identification', length: 6 }],
    [0x250, { name: 'Mode S MB Data', length: 8 }]
  ]);

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
    this.isProcessing = true;
    this.startTrackMaintenance();
    this.logger.info('Radar Data Processor initialized');
  }

  async shutdown(): Promise<void> {
    this.isProcessing = false;
    this.radarTracks.clear();
    this.aircraftMap.clear();
    this.subscribers = [];
    this.logger.info('Radar Data Processor shutdown completed');
  }

  async isHealthy(): Promise<boolean> {
    const activeRadars = Array.from(this.radarSites.values()).filter(site => site.isActive);
    const recentData = Date.now() - this.processingStats.lastProcessingTime < 30000;
    return activeRadars.length > 0 && recentData && this.isProcessing;
  }

  // Process raw radar data (ASTERIX format)
  async processRadarData(rawData: Buffer): Promise<Aircraft[]> {
    const startTime = Date.now();
    
    try {
      // Parse ASTERIX messages from raw data
      const messages = this.parseAsterixData(rawData);
      
      // Process each message
      for (const message of messages) {
        await this.processAsterixMessage(message);
      }
      
      // Convert radar tracks to aircraft objects
      const aircraft = this.convertTracksToAircraft();
      
      // Update processing statistics
      this.processingStats.messagesProcessed += messages.length;
      this.processingStats.tracksActive = this.radarTracks.size;
      this.processingStats.lastProcessingTime = Date.now();
      
      const processingTime = Date.now() - startTime;
      
      this.logger.debug('Radar data processed', {
        messageCount: messages.length,
        activeTrackCount: this.radarTracks.size,
        aircraftCount: aircraft.length,
        processingTime
      });
      
      // Notify subscribers
      this.notifySubscribers(aircraft);
      
      // Emit radar update event
      this.eventEmitter.emit('radar:data_processed', {
        aircraft,
        trackCount: this.radarTracks.size,
        processingTime
      });
      
      return aircraft;
    } catch (error) {
      this.processingStats.errorCount++;
      this.logger.error('Radar data processing failed', error as Error);
      throw error;
    }
  }

  // Get current aircraft positions
  async getAircraftPositions(): Promise<Aircraft[]> {
    return Array.from(this.aircraftMap.values());
  }

  // Subscribe to radar updates
  subscribeToRadarUpdates(callback: (aircraft: Aircraft[]) => void): void {
    this.subscribers.push(callback);
    this.logger.debug('New radar update subscriber added', {
      subscriberCount: this.subscribers.length
    });
  }

  // Get radar processing statistics
  getProcessingStats(): typeof this.processingStats {
    return { ...this.processingStats };
  }

  // Get radar site information
  getRadarSites(): RadarSite[] {
    return Array.from(this.radarSites.values());
  }

  // Update radar site status
  updateRadarSiteStatus(siteId: string, isActive: boolean): void {
    const site = this.radarSites.get(siteId);
    if (site) {
      site.isActive = isActive;
      site.lastHeartbeat = new Date();
      
      this.logger.info('Radar site status updated', {
        siteId,
        isActive,
        siteName: site.name
      });
      
      this.eventEmitter.emit('radar:site_status_changed', {
        siteId,
        isActive,
        site
      });
    }
  }

  // Private helper methods
  private parseAsterixData(rawData: Buffer): AsterixMessage[] {
    const messages: AsterixMessage[] = [];
    let offset = 0;
    
    while (offset < rawData.length - 3) {
      try {
        // Read ASTERIX header
        const category = rawData.readUInt8(offset);
        const length = rawData.readUInt16BE(offset + 1);
        
        if (offset + length > rawData.length) {
          this.logger.warn('Incomplete ASTERIX message detected', {
            expectedLength: length,
            remainingBytes: rawData.length - offset
          });
          break;
        }
        
        // Extract message data
        const messageData = rawData.subarray(offset + 3, offset + length);
        
        // Parse data source identifier
        const dataSourceId = messageData.length >= 2 ? 
          messageData.readUInt16BE(0) : 0;
        
        // Parse data blocks
        const dataBlocks = this.parseDataBlocks(messageData.subarray(2), category);
        
        messages.push({
          category,
          length,
          dataSourceId,
          timestamp: new Date(),
          data: dataBlocks
        });
        
        offset += length;
      } catch (error) {
        this.logger.error('ASTERIX parsing error', error as Error, { offset });
        offset += 1; // Skip byte and continue
      }
    }
    
    return messages;
  }

  private parseDataBlocks(data: Buffer, category: number): AsterixDataBlock[] {
    const blocks: AsterixDataBlock[] = [];
    
    if (category !== 48) {
      // Only handle Category 048 for now
      return blocks;
    }
    
    let offset = 0;
    
    while (offset < data.length) {
      try {
        // Read Field Reference Number (FRN) specification
        const fspec = this.readFieldSpecification(data, offset);
        offset += fspec.length;
        
        // Process each field indicated in FSPEC
        for (const fieldId of fspec.fields) {
          const fieldDef = this.asterixFields.get(fieldId);
          if (fieldDef && offset + fieldDef.length <= data.length) {
            const fieldData = data.subarray(offset, offset + fieldDef.length);
            
            blocks.push({
              itemId: fieldId,
              data: fieldData,
              decoded: this.decodeAsterixField(fieldId, fieldData)
            });
            
            offset += fieldDef.length;
          }
        }
      } catch (error) {
        this.logger.error('Data block parsing error', error as Error);
        break;
      }
    }
    
    return blocks;
  }

  private readFieldSpecification(data: Buffer, offset: number): {
    fields: number[];
    length: number;
  } {
    const fields: number[] = [];
    let fspecLength = 0;
    let byteIndex = 0;
    
    // Read FSPEC bytes until extension bit is 0
    do {
      if (offset + byteIndex >= data.length) break;
      
      const fspecByte = data.readUInt8(offset + byteIndex);
      fspecLength++;
      
      // Check each bit (except extension bit)
      for (let bit = 7; bit >= 1; bit--) {
        if (fspecByte & (1 << (bit - 1))) {
          const fieldId = (byteIndex * 7) + (8 - bit);
          // Map bit position to actual ASTERIX field IDs
          const asterixFieldId = this.mapBitToFieldId(fieldId);
          if (asterixFieldId) {
            fields.push(asterixFieldId);
          }
        }
      }
      
      byteIndex++;
    } while ((data.readUInt8(offset + byteIndex - 1) & 0x01) === 1);
    
    return { fields, length: fspecLength };
  }

  private mapBitToFieldId(bitPosition: number): number | null {
    // Map FSPEC bit positions to ASTERIX field IDs for Category 048
    const fieldMap: { [key: number]: number } = {
      1: 0x010, // Data Source Identifier
      2: 0x020, // Target Report Descriptor
      3: 0x040, // Measured Position in Polar Coordinates
      4: 0x070, // Mode-3/A Code
      5: 0x090, // Flight Level
      6: 0x130, // Radar Plot Characteristics
      7: 0x220, // Aircraft Address
      8: 0x240, // Aircraft Identification
      9: 0x250  // Mode S MB Data
    };
    
    return fieldMap[bitPosition] || null;
  }

  private decodeAsterixField(fieldId: number, data: Buffer): any {
    switch (fieldId) {
      case 0x010: // Data Source Identifier
        return {
          sac: data.readUInt8(0), // System Area Code
          sic: data.readUInt8(1)  // System Identification Code
        };
        
      case 0x040: // Measured Position in Polar Coordinates
        const rho = data.readUInt16BE(0) * (1/256); // Range in NM
        const theta = data.readUInt16BE(2) * (360/65536); // Azimuth in degrees
        return { range: rho, azimuth: theta };
        
      case 0x070: // Mode-3/A Code
        const mode3A = data.readUInt16BE(0) & 0x0FFF;
        return { code: mode3A.toString(8).padStart(4, '0') };
        
      case 0x090: // Flight Level
        const flightLevel = data.readInt16BE(0) * 0.25; // In 100ft increments
        return { flightLevel };
        
      case 0x240: // Aircraft Identification
        const callsign = data.toString('ascii').replace(/\0/g, '').trim();
        return { callsign };
        
      default:
        return { raw: data };
    }
  }

  private async processAsterixMessage(message: AsterixMessage): Promise<void> {
    try {
      // Extract track information from data blocks
      const trackData = this.extractTrackData(message);
      
      if (trackData) {
        // Update or create radar track
        this.updateRadarTrack(trackData);
        
        // Update radar site heartbeat
        this.updateRadarSiteHeartbeat(message.dataSourceId.toString());
      }
    } catch (error) {
      this.logger.error('ASTERIX message processing failed', error as Error, {
        category: message.category,
        dataSourceId: message.dataSourceId
      });
    }
  }

  private extractTrackData(message: AsterixMessage): Partial<RadarTrack> | null {
    const trackData: any = {};
    
    for (const block of message.data) {
      if (!block.decoded) continue;
      
      switch (block.itemId) {
        case 0x040: // Position
          if (block.decoded.range && block.decoded.azimuth) {
            // Convert polar to Cartesian coordinates
            // This is simplified - real implementation would use radar site position
            const lat = 40.6892; // EWR approximate latitude
            const lon = -74.1745; // EWR approximate longitude
            
            trackData.position = {
              latitude: lat,
              longitude: lon,
              altitude: trackData.flightLevel || 0,
              timestamp: message.timestamp
            };
          }
          break;
          
        case 0x070: // Mode 3/A Code
          trackData.squawkCode = block.decoded.code;
          break;
          
        case 0x090: // Flight Level
          trackData.flightLevel = block.decoded.flightLevel * 100; // Convert to feet
          break;
          
        case 0x240: // Aircraft Identification
          trackData.callsign = block.decoded.callsign;
          break;
      }
    }
    
    // Generate track number if not present
    if (!trackData.trackNumber) {
      trackData.trackNumber = this.generateTrackNumber(message.dataSourceId, trackData.squawkCode);
    }
    
    return Object.keys(trackData).length > 0 ? trackData : null;
  }

  private updateRadarTrack(trackData: Partial<RadarTrack>): void {
    if (!trackData.trackNumber) return;
    
    const existingTrack = this.radarTracks.get(trackData.trackNumber);
    
    if (existingTrack) {
      // Update existing track
      const updatedTrack: RadarTrack = {
        ...existingTrack,
        ...trackData,
        lastUpdate: new Date(),
        trackQuality: this.calculateTrackQuality(existingTrack, trackData)
      };
      
      // Calculate velocity if we have position history
      if (trackData.position && existingTrack.position) {
        updatedTrack.velocity = this.calculateVelocity(
          existingTrack.position,
          trackData.position,
          existingTrack.lastUpdate,
          new Date()
        );
        
        updatedTrack.heading = this.calculateHeading(updatedTrack.velocity);
        updatedTrack.groundSpeed = this.calculateGroundSpeed(updatedTrack.velocity);
      }
      
      this.radarTracks.set(trackData.trackNumber, updatedTrack);
    } else {
      // Create new track
      const newTrack: RadarTrack = {
        trackNumber: trackData.trackNumber,
        callsign: trackData.callsign,
        position: trackData.position || {
          latitude: 0,
          longitude: 0,
          altitude: 0,
          timestamp: new Date()
        },
        velocity: { x: 0, y: 0, z: 0 },
        heading: 0,
        squawkCode: trackData.squawkCode,
        flightLevel: trackData.flightLevel,
        lastUpdate: new Date(),
        trackQuality: {
          confidence: 0.8,
          positionAccuracy: 100, // meters
          velocityAccuracy: 5, // m/s
          ageSeconds: 0,
          sourceReliability: 0.9
        }
      };
      
      this.radarTracks.set(trackData.trackNumber, newTrack);
    }
  }

  private convertTracksToAircraft(): Aircraft[] {
    const aircraft: Aircraft[] = [];
    const now = new Date();
    
    for (const track of this.radarTracks.values()) {
      // Skip stale tracks (older than 30 seconds)
      const ageSeconds = (now.getTime() - track.lastUpdate.getTime()) / 1000;
      if (ageSeconds > 30) continue;
      
      const aircraftObj: Aircraft = {
        callsign: track.callsign || `TRK${track.trackNumber}`,
        flightPlan: {
          origin: 'UNKNOWN',
          destination: 'UNKNOWN',
          route: '',
          cruiseAltitude: track.flightLevel || 0,
          estimatedDeparture: new Date(),
          estimatedArrival: new Date()
        },
        currentPosition: track.position,
        velocity: track.velocity,
        altitude: track.flightLevel || track.position.altitude,
        heading: track.heading,
        squawkCode: track.squawkCode || '0000',
        status: this.determineAircraftStatus(track),
        clearances: [],
        lastUpdate: track.lastUpdate
      };
      
      aircraft.push(aircraftObj);
      this.aircraftMap.set(aircraftObj.callsign, aircraftObj);
    }
    
    return aircraft;
  }

  private determineAircraftStatus(track: RadarTrack): AircraftStatus {
    if (!track.groundSpeed) return AircraftStatus.UNKNOWN;
    
    if (track.groundSpeed < 5) {
      return AircraftStatus.HOLDING;
    } else if (track.flightLevel && track.flightLevel < 1000) {
      return track.groundSpeed > 50 ? AircraftStatus.DEPARTING : AircraftStatus.TAXIING;
    } else {
      return AircraftStatus.ARRIVING;
    }
  }

  private calculateVelocity(
    pos1: Position3D,
    pos2: Position3D,
    time1: Date,
    time2: Date
  ): Vector3D {
    const deltaTime = (time2.getTime() - time1.getTime()) / 1000; // seconds
    
    if (deltaTime <= 0) return { x: 0, y: 0, z: 0 };
    
    // Simplified velocity calculation (should use proper geodetic calculations)
    const deltaLat = (pos2.latitude - pos1.latitude) * 111320; // meters per degree
    const deltaLon = (pos2.longitude - pos1.longitude) * 111320 * Math.cos(pos1.latitude * Math.PI / 180);
    const deltaAlt = pos2.altitude - pos1.altitude;
    
    return {
      x: deltaLon / deltaTime,
      y: deltaLat / deltaTime,
      z: deltaAlt / deltaTime
    };
  }

  private calculateHeading(velocity: Vector3D): number {
    const heading = Math.atan2(velocity.x, velocity.y) * 180 / Math.PI;
    return heading < 0 ? heading + 360 : heading;
  }

  private calculateGroundSpeed(velocity: Vector3D): number {
    return Math.sqrt(velocity.x * velocity.x + velocity.y * velocity.y);
  }

  private calculateTrackQuality(existing: RadarTrack, update: Partial<RadarTrack>): TrackQuality {
    const ageSeconds = (Date.now() - existing.lastUpdate.getTime()) / 1000;
    
    return {
      confidence: Math.max(0.1, existing.trackQuality.confidence - (ageSeconds * 0.01)),
      positionAccuracy: existing.trackQuality.positionAccuracy,
      velocityAccuracy: existing.trackQuality.velocityAccuracy,
      ageSeconds,
      sourceReliability: existing.trackQuality.sourceReliability
    };
  }

  private generateTrackNumber(dataSourceId: number, squawkCode?: string): number {
    // Generate unique track number based on data source and squawk code
    const base = dataSourceId * 10000;
    const suffix = squawkCode ? parseInt(squawkCode, 8) % 1000 : Math.floor(Math.random() * 1000);
    return base + suffix;
  }

  private initializeRadarSites(): void {
    // Initialize EWR area radar sites
    this.radarSites.set('EWR_PRIMARY', {
      id: 'EWR_PRIMARY',
      name: 'Newark Primary Radar',
      position: {
        latitude: 40.6892,
        longitude: -74.1745,
        altitude: 100,
        timestamp: new Date()
      },
      range: 60, // nautical miles
      isActive: true,
      lastHeartbeat: new Date()
    });
    
    this.radarSites.set('N90_TRACON', {
      id: 'N90_TRACON',
      name: 'New York TRACON',
      position: {
        latitude: 40.7128,
        longitude: -74.0060,
        altitude: 200,
        timestamp: new Date()
      },
      range: 80,
      isActive: true,
      lastHeartbeat: new Date()
    });
  }

  private updateRadarSiteHeartbeat(siteId: string): void {
    const site = this.radarSites.get(siteId);
    if (site) {
      site.lastHeartbeat = new Date();
      site.isActive = true;
    }
  }

  private startTrackMaintenance(): void {
    // Clean up stale tracks every 30 seconds
    setInterval(() => {
      if (!this.isProcessing) return;
      
      const now = new Date();
      const staleThreshold = 60000; // 1 minute
      
      for (const [trackNumber, track] of this.radarTracks) {
        const age = now.getTime() - track.lastUpdate.getTime();
        if (age > staleThreshold) {
          this.radarTracks.delete(trackNumber);
          this.aircraftMap.delete(track.callsign || `TRK${trackNumber}`);
          
          this.logger.debug('Removed stale radar track', {
            trackNumber,
            callsign: track.callsign,
            ageSeconds: age / 1000
          });
        }
      }
    }, 30000);
  }

  private notifySubscribers(aircraft: Aircraft[]): void {
    for (const callback of this.subscribers) {
      try {
        callback(aircraft);
      } catch (error) {
        this.logger.error('Radar subscriber callback failed', error as Error);
      }
    }
  }
}
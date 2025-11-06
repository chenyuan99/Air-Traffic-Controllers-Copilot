import { ILogger } from '../interfaces/IService';

export interface AsterixCategory {
  number: number;
  name: string;
  fields: Map<number, AsterixFieldDefinition>;
}

export interface AsterixFieldDefinition {
  id: number;
  name: string;
  type: FieldType;
  length?: number; // Fixed length fields
  subfields?: AsterixSubfield[];
  decoder: (data: Buffer) => any;
}

export interface AsterixSubfield {
  name: string;
  bits: number;
  scale?: number;
  offset?: number;
  unit?: string;
  decoder?: (value: number) => any;
}

export enum FieldType {
  FIXED = 'FIXED',
  VARIABLE = 'VARIABLE',
  REPETITIVE = 'REPETITIVE',
  COMPOUND = 'COMPOUND'
}

export class AsterixDecoder {
  private logger: ILogger;
  private categories = new Map<number, AsterixCategory>();

  constructor(logger: ILogger) {
    this.logger = logger;
    this.initializeCategories();
  }

  // Decode ASTERIX message
  decodeMessage(category: number, data: Buffer): any {
    const categoryDef = this.categories.get(category);
    if (!categoryDef) {
      throw new Error(`Unsupported ASTERIX category: ${category}`);
    }

    try {
      return this.decodeDataRecord(categoryDef, data);
    } catch (error) {
      this.logger.error('ASTERIX decoding failed', error as Error, { category });
      throw error;
    }
  }

  // Get supported categories
  getSupportedCategories(): number[] {
    return Array.from(this.categories.keys());
  }

  // Private methods
  private initializeCategories(): void {
    // Initialize Category 048 (Monoradar Target Reports)
    this.initializeCategory048();
    
    // Initialize Category 062 (System Track Data)
    this.initializeCategory062();
  }

  private initializeCategory048(): void {
    const cat048: AsterixCategory = {
      number: 48,
      name: 'Monoradar Target Reports',
      fields: new Map()
    };

    // I048/010 - Data Source Identifier
    cat048.fields.set(0x010, {
      id: 0x010,
      name: 'Data Source Identifier',
      type: FieldType.FIXED,
      length: 2,
      decoder: (data: Buffer) => ({
        sac: data.readUInt8(0), // System Area Code
        sic: data.readUInt8(1)  // System Identification Code
      })
    });

    // I048/020 - Target Report Descriptor
    cat048.fields.set(0x020, {
      id: 0x020,
      name: 'Target Report Descriptor',
      type: FieldType.VARIABLE,
      decoder: (data: Buffer) => {
        const firstByte = data.readUInt8(0);
        return {
          typ: (firstByte >> 5) & 0x07, // Target type
          sim: (firstByte >> 4) & 0x01, // Simulated target
          rdp: (firstByte >> 3) & 0x01, // RDP Chain
          spi: (firstByte >> 2) & 0x01, // Special Position Identification
          rab: (firstByte >> 1) & 0x01, // Report from aircraft beacon
          tst: firstByte & 0x01         // Test target
        };
      }
    });

    // I048/040 - Measured Position in Polar Coordinates
    cat048.fields.set(0x040, {
      id: 0x040,
      name: 'Measured Position in Polar Coordinates',
      type: FieldType.FIXED,
      length: 4,
      decoder: (data: Buffer) => {
        const rho = data.readUInt16BE(0) * (1/256); // Range in NM
        const theta = data.readUInt16BE(2) * (360/65536); // Azimuth in degrees
        return {
          range: rho,
          azimuth: theta,
          rangeNM: rho,
          azimuthDeg: theta
        };
      }
    });

    // I048/070 - Mode-3/A Code in Octal Representation
    cat048.fields.set(0x070, {
      id: 0x070,
      name: 'Mode-3/A Code in Octal Representation',
      type: FieldType.FIXED,
      length: 2,
      decoder: (data: Buffer) => {
        const raw = data.readUInt16BE(0);
        const v = (raw >> 15) & 0x01; // Validated
        const g = (raw >> 14) & 0x01; // Garbled
        const l = (raw >> 13) & 0x01; // Smoothed
        const code = raw & 0x0FFF;    // Mode 3/A code
        
        return {
          validated: v === 1,
          garbled: g === 1,
          smoothed: l === 1,
          code: code.toString(8).padStart(4, '0'),
          codeOctal: code
        };
      }
    });

    // I048/090 - Flight Level in Binary Representation
    cat048.fields.set(0x090, {
      id: 0x090,
      name: 'Flight Level in Binary Representation',
      type: FieldType.FIXED,
      length: 2,
      decoder: (data: Buffer) => {
        const raw = data.readInt16BE(0);
        const v = (raw >> 15) & 0x01; // Validated
        const g = (raw >> 14) & 0x01; // Garbled
        const flightLevel = (raw & 0x3FFF) * 0.25; // In 100ft increments
        
        return {
          validated: v === 1,
          garbled: g === 1,
          flightLevel: flightLevel,
          altitude: flightLevel * 100 // Convert to feet
        };
      }
    });

    // I048/220 - Aircraft Address
    cat048.fields.set(0x220, {
      id: 0x220,
      name: 'Aircraft Address',
      type: FieldType.FIXED,
      length: 3,
      decoder: (data: Buffer) => {
        const address = (data.readUInt8(0) << 16) | 
                       (data.readUInt8(1) << 8) | 
                       data.readUInt8(2);
        return {
          address: address,
          addressHex: address.toString(16).toUpperCase().padStart(6, '0')
        };
      }
    });

    // I048/240 - Aircraft Identification
    cat048.fields.set(0x240, {
      id: 0x240,
      name: 'Aircraft Identification',
      type: FieldType.FIXED,
      length: 6,
      decoder: (data: Buffer) => {
        // Decode 6-bit characters
        let callsign = '';
        for (let i = 0; i < 8; i++) {
          const byteIndex = Math.floor(i * 6 / 8);
          const bitOffset = (i * 6) % 8;
          
          if (byteIndex < data.length) {
            let char6bit;
            if (bitOffset <= 2) {
              char6bit = (data.readUInt8(byteIndex) >> (2 - bitOffset)) & 0x3F;
            } else {
              const highBits = (data.readUInt8(byteIndex) & ((1 << (8 - bitOffset)) - 1)) << (bitOffset - 2);
              const lowBits = byteIndex + 1 < data.length ? 
                (data.readUInt8(byteIndex + 1) >> (10 - bitOffset)) & ((1 << (bitOffset - 2)) - 1) : 0;
              char6bit = highBits | lowBits;
            }
            
            // Convert 6-bit to ASCII
            if (char6bit >= 1 && char6bit <= 26) {
              callsign += String.fromCharCode(char6bit + 64); // A-Z
            } else if (char6bit >= 48 && char6bit <= 57) {
              callsign += String.fromCharCode(char6bit); // 0-9
            } else if (char6bit === 32) {
              callsign += ' ';
            }
          }
        }
        
        return {
          callsign: callsign.trim(),
          raw: data
        };
      }
    });

    this.categories.set(48, cat048);
  }

  private initializeCategory062(): void {
    const cat062: AsterixCategory = {
      number: 62,
      name: 'System Track Data',
      fields: new Map()
    };

    // I062/010 - Data Source Identifier
    cat062.fields.set(0x010, {
      id: 0x010,
      name: 'Data Source Identifier',
      type: FieldType.FIXED,
      length: 2,
      decoder: (data: Buffer) => ({
        sac: data.readUInt8(0),
        sic: data.readUInt8(1)
      })
    });

    // I062/040 - Track Number
    cat062.fields.set(0x040, {
      id: 0x040,
      name: 'Track Number',
      type: FieldType.FIXED,
      length: 2,
      decoder: (data: Buffer) => ({
        trackNumber: data.readUInt16BE(0)
      })
    });

    // I062/105 - Calculated Position in WGS-84 Coordinates
    cat062.fields.set(0x105, {
      id: 0x105,
      name: 'Calculated Position in WGS-84 Coordinates',
      type: FieldType.FIXED,
      length: 8,
      decoder: (data: Buffer) => {
        const lat = data.readInt32BE(0) * (180 / Math.pow(2, 25)); // degrees
        const lon = data.readInt32BE(4) * (180 / Math.pow(2, 25)); // degrees
        
        return {
          latitude: lat,
          longitude: lon,
          wgs84: true
        };
      }
    });

    // I062/136 - Measured Flight Level
    cat062.fields.set(0x136, {
      id: 0x136,
      name: 'Measured Flight Level',
      type: FieldType.FIXED,
      length: 2,
      decoder: (data: Buffer) => {
        const flightLevel = data.readInt16BE(0) * 0.25;
        return {
          flightLevel: flightLevel,
          altitude: flightLevel * 100
        };
      }
    });

    // I062/380 - Aircraft Derived Data
    cat062.fields.set(0x380, {
      id: 0x380,
      name: 'Aircraft Derived Data',
      type: FieldType.COMPOUND,
      decoder: (data: Buffer) => {
        // Simplified compound field decoder
        return {
          raw: data,
          // Would contain subfields like target identification, 
          // magnetic heading, indicated airspeed, etc.
        };
      }
    });

    this.categories.set(62, cat062);
  }

  private decodeDataRecord(category: AsterixCategory, data: Buffer): any {
    const result: any = {
      category: category.number,
      fields: {}
    };

    let offset = 0;

    // Read FSPEC (Field Specification)
    const fspec = this.readFSPEC(data, offset);
    offset += fspec.length;

    // Process each field indicated in FSPEC
    for (const fieldId of fspec.presentFields) {
      const fieldDef = category.fields.get(fieldId);
      if (!fieldDef) {
        this.logger.warn('Unknown field in ASTERIX message', {
          category: category.number,
          fieldId: fieldId.toString(16)
        });
        continue;
      }

      try {
        const fieldLength = this.getFieldLength(fieldDef, data, offset);
        if (offset + fieldLength > data.length) {
          throw new Error(`Insufficient data for field ${fieldId.toString(16)}`);
        }

        const fieldData = data.subarray(offset, offset + fieldLength);
        const decodedField = fieldDef.decoder(fieldData);

        result.fields[fieldDef.name] = decodedField;
        offset += fieldLength;
      } catch (error) {
        this.logger.error('Field decoding failed', error as Error, {
          category: category.number,
          fieldId: fieldId.toString(16)
        });
        // Skip this field and continue
        offset += 1;
      }
    }

    return result;
  }

  private readFSPEC(data: Buffer, offset: number): {
    presentFields: number[];
    length: number;
  } {
    const presentFields: number[] = [];
    let fspecLength = 0;
    let fieldIndex = 1;

    // Read FSPEC bytes until extension bit is 0
    do {
      if (offset + fspecLength >= data.length) {
        throw new Error('Incomplete FSPEC in ASTERIX message');
      }

      const fspecByte = data.readUInt8(offset + fspecLength);
      fspecLength++;

      // Check each bit (except extension bit)
      for (let bit = 7; bit >= 1; bit--) {
        if (fspecByte & (1 << (bit - 1))) {
          // Map field index to actual field ID
          const fieldId = this.mapFieldIndexToId(fieldIndex);
          if (fieldId) {
            presentFields.push(fieldId);
          }
        }
        fieldIndex++;
      }
    } while ((data.readUInt8(offset + fspecLength - 1) & 0x01) === 1);

    return { presentFields, length: fspecLength };
  }

  private mapFieldIndexToId(index: number): number | null {
    // Map FSPEC field indices to actual ASTERIX field IDs
    // This is a simplified mapping for Category 048
    const fieldMap: { [key: number]: number } = {
      1: 0x010,  // Data Source Identifier
      2: 0x020,  // Target Report Descriptor
      3: 0x040,  // Measured Position in Polar Coordinates
      4: 0x070,  // Mode-3/A Code
      5: 0x090,  // Flight Level
      6: 0x130,  // Radar Plot Characteristics
      7: 0x220,  // Aircraft Address
      8: 0x240,  // Aircraft Identification
      9: 0x250,  // Mode S MB Data
      10: 0x161, // Track Number
      11: 0x042, // Calculated Position in Cartesian Coordinates
      12: 0x200, // Mode of Movement
      13: 0x170, // Track Status
      14: 0x210, // Track Quality
      15: 0x030, // Warning/Error Conditions
      16: 0x080, // Mode-3/A Code Confidence Indicator
      17: 0x100, // Mode-C Code and Code Confidence Indicator
      18: 0x110, // Height Measured by 3D Radar
      19: 0x120, // Radial Doppler Speed
      20: 0x230, // Communications/ACAS Capability and Flight Status
      21: 0x260, // ACAS Resolution Advisory Report
      22: 0x055, // Mode-1 Code in Octal Representation
      23: 0x050, // Mode-2 Code in Octal Representation
      24: 0x065, // Mode-1 Code Confidence Indicator
      25: 0x060, // Mode-2 Code Confidence Indicator
      26: 0x SP,  // Special Purpose Field
      27: 0x RE   // Reserved Expansion Field
    };

    return fieldMap[index] || null;
  }

  private getFieldLength(fieldDef: AsterixFieldDefinition, data: Buffer, offset: number): number {
    switch (fieldDef.type) {
      case FieldType.FIXED:
        return fieldDef.length || 0;

      case FieldType.VARIABLE:
        // Variable length field - read length from first byte(s)
        if (offset >= data.length) return 0;
        
        let length = 0;
        let byteIndex = 0;
        
        // Read length bytes until extension bit is 0
        do {
          if (offset + byteIndex >= data.length) break;
          length++;
          byteIndex++;
        } while ((data.readUInt8(offset + byteIndex - 1) & 0x01) === 1);
        
        return length;

      case FieldType.REPETITIVE:
        // Repetitive field - first byte indicates number of repetitions
        if (offset >= data.length) return 0;
        const repetitions = data.readUInt8(offset);
        const itemLength = fieldDef.length || 1;
        return 1 + (repetitions * itemLength);

      case FieldType.COMPOUND:
        // Compound field - has its own FSPEC
        return this.getCompoundFieldLength(data, offset);

      default:
        return 0;
    }
  }

  private getCompoundFieldLength(data: Buffer, offset: number): number {
    // Read compound field FSPEC to determine total length
    let length = 0;
    let fspecLength = 0;

    // Read FSPEC
    do {
      if (offset + fspecLength >= data.length) break;
      fspecLength++;
    } while ((data.readUInt8(offset + fspecLength - 1) & 0x01) === 1);

    length += fspecLength;

    // This is simplified - real implementation would parse subfields
    // For now, assume remaining data belongs to this field
    return Math.min(data.length - offset, length + 10);
  }
}

// Constants for special fields
const SP = 0xSP; // Special Purpose Field
const RE = 0xRE; // Reserved Expansion Field
import { VoiceCommand, ActionType } from './VoiceInterface';

// Comprehensive set of ATC-specific voice commands
export class VoiceCommands {
  
  // Get all predefined voice commands
  static getAllCommands(): VoiceCommand[] {
    return [
      ...this.getSystemCommands(),
      ...this.getNavigationCommands(),
      ...this.getAircraftCommands(),
      ...this.getWeatherCommands(),
      ...this.getAlertCommands(),
      ...this.getFlightStripCommands(),
      ...this.getRadioCommands()
    ];
  }

  // System control commands
  static getSystemCommands(): VoiceCommand[] {
    return [
      {
        id: 'system_status',
        phrase: 'system status',
        patterns: [
          'system status',
          'status report',
          'system check',
          'health check',
          'system overview'
        ],
        action: { type: ActionType.SYSTEM_STATUS },
        confidence: 0.9
      },
      {
        id: 'help',
        phrase: 'help',
        patterns: [
          'help',
          'commands',
          'what can you do',
          'voice commands',
          'assistance'
        ],
        action: { type: ActionType.CUSTOM_COMMAND, target: 'help' },
        confidence: 0.9
      },
      {
        id: 'settings',
        phrase: 'settings',
        patterns: [
          'settings',
          'preferences',
          'configuration',
          'options'
        ],
        action: { type: ActionType.SHOW_PANEL, target: 'settings' },
        confidence: 0.8
      }
    ];
  }

  // Navigation and panel control commands
  static getNavigationCommands(): VoiceCommand[] {
    return [
      {
        id: 'show_aircraft_panel',
        phrase: 'show aircraft',
        patterns: [
          'show aircraft',
          'display aircraft',
          'aircraft list',
          'aircraft panel',
          'open aircraft'
        ],
        action: { type: ActionType.SHOW_PANEL, target: 'aircraft' },
        confidence: 0.9
      },
      {
        id: 'hide_aircraft_panel',
        phrase: 'hide aircraft',
        patterns: [
          'hide aircraft',
          'close aircraft',
          'aircraft panel off',
          'minimize aircraft'
        ],
        action: { type: ActionType.HIDE_PANEL, target: 'aircraft' },
        confidence: 0.9
      },
      {
        id: 'show_alerts_panel',
        phrase: 'show alerts',
        patterns: [
          'show alerts',
          'display alerts',
          'alert panel',
          'open alerts',
          'show warnings'
        ],
        action: { type: ActionType.SHOW_PANEL, target: 'alerts' },
        confidence: 0.9
      },
      {
        id: 'hide_alerts_panel',
        phrase: 'hide alerts',
        patterns: [
          'hide alerts',
          'close alerts',
          'alert panel off',
          'minimize alerts'
        ],
        action: { type: ActionType.HIDE_PANEL, target: 'alerts' },
        confidence: 0.9
      },
      {
        id: 'show_weather_panel',
        phrase: 'show weather',
        patterns: [
          'show weather',
          'display weather',
          'weather panel',
          'open weather',
          'weather display'
        ],
        action: { type: ActionType.SHOW_PANEL, target: 'weather' },
        confidence: 0.9
      },
      {
        id: 'show_flight_strips',
        phrase: 'show flight strips',
        patterns: [
          'show flight strips',
          'display strips',
          'flight strips panel',
          'open strips'
        ],
        action: { type: ActionType.SHOW_PANEL, target: 'flight_strips' },
        confidence: 0.9
      }
    ];
  }

  // Aircraft-specific commands
  static getAircraftCommands(): VoiceCommand[] {
    return [
      {
        id: 'query_aircraft_status',
        phrase: 'aircraft * status',
        patterns: [
          'aircraft * status',
          'show aircraft *',
          'query aircraft *',
          '* status',
          'information on *'
        ],
        action: { type: ActionType.QUERY_AIRCRAFT },
        parameters: [{
          name: 'callsign',
          type: 'callsign',
          required: true,
          pattern: /(?:aircraft\s+)?([A-Z]{2,3}\d{1,4}[A-Z]?)/i
        }],
        confidence: 0.8
      },
      {
        id: 'query_aircraft_altitude',
        phrase: 'what altitude is *',
        patterns: [
          'what altitude is *',
          'altitude of *',
          '* altitude',
          'how high is *'
        ],
        action: { type: ActionType.QUERY_AIRCRAFT, target: 'altitude' },
        parameters: [{
          name: 'callsign',
          type: 'callsign',
          required: true,
          pattern: /(?:altitude\s+(?:is|of)\s+)?([A-Z]{2,3}\d{1,4}[A-Z]?)/i
        }],
        confidence: 0.8
      },
      {
        id: 'query_aircraft_heading',
        phrase: 'what heading is *',
        patterns: [
          'what heading is *',
          'heading of *',
          '* heading',
          'which way is * going'
        ],
        action: { type: ActionType.QUERY_AIRCRAFT, target: 'heading' },
        parameters: [{
          name: 'callsign',
          type: 'callsign',
          required: true,
          pattern: /(?:heading\s+(?:is|of)\s+)?([A-Z]{2,3}\d{1,4}[A-Z]?)/i
        }],
        confidence: 0.8
      },
      {
        id: 'count_aircraft',
        phrase: 'how many aircraft',
        patterns: [
          'how many aircraft',
          'aircraft count',
          'number of aircraft',
          'total aircraft'
        ],
        action: { type: ActionType.CUSTOM_COMMAND, target: 'count_aircraft' },
        confidence: 0.9
      }
    ];
  }

  // Weather-related commands
  static getWeatherCommands(): VoiceCommand[] {
    return [
      {
        id: 'current_weather',
        phrase: 'current weather',
        patterns: [
          'current weather',
          'weather report',
          'what is the weather',
          'weather conditions',
          'METAR'
        ],
        action: { type: ActionType.QUERY_WEATHER },
        confidence: 0.9
      },
      {
        id: 'wind_conditions',
        phrase: 'wind conditions',
        patterns: [
          'wind conditions',
          'wind speed',
          'wind direction',
          'what is the wind',
          'current winds'
        ],
        action: { type: ActionType.QUERY_WEATHER, target: 'wind' },
        confidence: 0.9
      },
      {
        id: 'visibility',
        phrase: 'visibility',
        patterns: [
          'visibility',
          'current visibility',
          'how far can we see',
          'vis report'
        ],
        action: { type: ActionType.QUERY_WEATHER, target: 'visibility' },
        confidence: 0.9
      },
      {
        id: 'runway_conditions',
        phrase: 'runway conditions',
        patterns: [
          'runway conditions',
          'runway status',
          'which runway is active',
          'preferred runway'
        ],
        action: { type: ActionType.CUSTOM_COMMAND, target: 'runway_conditions' },
        confidence: 0.8
      }
    ];
  }

  // Alert management commands
  static getAlertCommands(): VoiceCommand[] {
    return [
      {
        id: 'acknowledge_alert',
        phrase: 'acknowledge alert',
        patterns: [
          'acknowledge alert',
          'ack alert',
          'roger alert',
          'alert acknowledged',
          'confirm alert'
        ],
        action: { type: ActionType.ACKNOWLEDGE_ALERT },
        confidence: 0.9,
        requiresConfirmation: false
      },
      {
        id: 'acknowledge_all_alerts',
        phrase: 'acknowledge all alerts',
        patterns: [
          'acknowledge all alerts',
          'ack all alerts',
          'clear all alerts',
          'acknowledge everything'
        ],
        action: { type: ActionType.ACKNOWLEDGE_ALERT, target: 'all' },
        confidence: 0.8,
        requiresConfirmation: true
      },
      {
        id: 'mute_alerts',
        phrase: 'mute alerts',
        patterns: [
          'mute alerts',
          'silence alerts',
          'quiet alerts',
          'stop alert sounds'
        ],
        action: { type: ActionType.CUSTOM_COMMAND, target: 'mute_alerts' },
        confidence: 0.9
      },
      {
        id: 'unmute_alerts',
        phrase: 'unmute alerts',
        patterns: [
          'unmute alerts',
          'enable alert sounds',
          'turn on alerts',
          'restore alerts'
        ],
        action: { type: ActionType.CUSTOM_COMMAND, target: 'unmute_alerts' },
        confidence: 0.9
      }
    ];
  }

  // Flight strip management commands
  static getFlightStripCommands(): VoiceCommand[] {
    return [
      {
        id: 'create_flight_strip',
        phrase: 'create strip for *',
        patterns: [
          'create strip for *',
          'new strip for *',
          'add strip *',
          'make strip for *'
        ],
        action: { type: ActionType.UPDATE_FLIGHT_STRIP, target: 'create' },
        parameters: [{
          name: 'callsign',
          type: 'callsign',
          required: true,
          pattern: /(?:strip\s+for\s+)?([A-Z]{2,3}\d{1,4}[A-Z]?)/i
        }],
        confidence: 0.8
      },
      {
        id: 'update_altitude_strip',
        phrase: 'update * altitude to *',
        patterns: [
          'update * altitude to *',
          'change * altitude to *',
          'set * altitude *',
          '* climb to *',
          '* descend to *'
        ],
        action: { type: ActionType.UPDATE_FLIGHT_STRIP, target: 'altitude' },
        parameters: [
          {
            name: 'callsign',
            type: 'callsign',
            required: true,
            pattern: /update\s+([A-Z]{2,3}\d{1,4}[A-Z]?)\s+altitude/i
          },
          {
            name: 'altitude',
            type: 'altitude',
            required: true,
            pattern: /altitude\s+to\s+([FL]?\d+)/i
          }
        ],
        confidence: 0.7
      },
      {
        id: 'update_heading_strip',
        phrase: 'update * heading to *',
        patterns: [
          'update * heading to *',
          'change * heading to *',
          'turn * to heading *',
          '* turn left *',
          '* turn right *'
        ],
        action: { type: ActionType.UPDATE_FLIGHT_STRIP, target: 'heading' },
        parameters: [
          {
            name: 'callsign',
            type: 'callsign',
            required: true,
            pattern: /(?:update|turn)\s+([A-Z]{2,3}\d{1,4}[A-Z]?)/i
          },
          {
            name: 'heading',
            type: 'heading',
            required: true,
            pattern: /(?:heading\s+to\s+|to\s+heading\s+)?(\d{1,3})/i
          }
        ],
        confidence: 0.7
      }
    ];
  }

  // Radio communication commands
  static getRadioCommands(): VoiceCommand[] {
    return [
      {
        id: 'change_frequency',
        phrase: 'change frequency to *',
        patterns: [
          'change frequency to *',
          'tune to *',
          'frequency *',
          'switch to *'
        ],
        action: { type: ActionType.CUSTOM_COMMAND, target: 'change_frequency' },
        parameters: [{
          name: 'frequency',
          type: 'frequency',
          required: true,
          pattern: /(?:frequency\s+to\s+|tune\s+to\s+)?(\d{3}\.\d{1,3})/i
        }],
        confidence: 0.8
      },
      {
        id: 'radio_check',
        phrase: 'radio check',
        patterns: [
          'radio check',
          'comm check',
          'communication check',
          'test radio'
        ],
        action: { type: ActionType.CUSTOM_COMMAND, target: 'radio_check' },
        confidence: 0.9
      }
    ];
  }

  // Emergency and priority commands
  static getEmergencyCommands(): VoiceCommand[] {
    return [
      {
        id: 'emergency_mode',
        phrase: 'emergency mode',
        patterns: [
          'emergency mode',
          'emergency',
          'mayday',
          'pan pan',
          'priority traffic'
        ],
        action: { type: ActionType.CUSTOM_COMMAND, target: 'emergency_mode' },
        confidence: 0.95,
        requiresConfirmation: true,
        context: ['emergency']
      },
      {
        id: 'clear_emergency',
        phrase: 'clear emergency',
        patterns: [
          'clear emergency',
          'cancel emergency',
          'emergency over',
          'normal operations'
        ],
        action: { type: ActionType.CUSTOM_COMMAND, target: 'clear_emergency' },
        confidence: 0.9,
        context: ['emergency']
      }
    ];
  }

  // Utility commands for system interaction
  static getUtilityCommands(): VoiceCommand[] {
    return [
      {
        id: 'repeat_last',
        phrase: 'repeat',
        patterns: [
          'repeat',
          'say again',
          'repeat that',
          'what did you say'
        ],
        action: { type: ActionType.CUSTOM_COMMAND, target: 'repeat_last' },
        confidence: 0.9
      },
      {
        id: 'cancel_command',
        phrase: 'cancel',
        patterns: [
          'cancel',
          'abort',
          'never mind',
          'stop',
          'disregard'
        ],
        action: { type: ActionType.CUSTOM_COMMAND, target: 'cancel' },
        confidence: 0.9
      },
      {
        id: 'voice_off',
        phrase: 'voice off',
        patterns: [
          'voice off',
          'disable voice',
          'stop listening',
          'voice control off'
        ],
        action: { type: ActionType.CUSTOM_COMMAND, target: 'voice_off' },
        confidence: 0.9,
        requiresConfirmation: true
      }
    ];
  }

  // Context-specific commands that change based on current operation
  static getContextualCommands(context: string[]): VoiceCommand[] {
    const commands: VoiceCommand[] = [];

    if (context.includes('conflict')) {
      commands.push({
        id: 'resolve_conflict',
        phrase: 'resolve conflict',
        patterns: [
          'resolve conflict',
          'conflict resolution',
          'suggest resolution',
          'how to resolve'
        ],
        action: { type: ActionType.CUSTOM_COMMAND, target: 'resolve_conflict' },
        confidence: 0.8,
        context: ['conflict']
      });
    }

    if (context.includes('weather')) {
      commands.push({
        id: 'weather_impact',
        phrase: 'weather impact',
        patterns: [
          'weather impact',
          'how does weather affect',
          'weather effects',
          'impact analysis'
        ],
        action: { type: ActionType.CUSTOM_COMMAND, target: 'weather_impact' },
        confidence: 0.8,
        context: ['weather']
      });
    }

    return commands;
  }

  // Get commands filtered by confidence threshold
  static getCommandsByConfidence(minConfidence: number): VoiceCommand[] {
    return this.getAllCommands().filter(cmd => cmd.confidence >= minConfidence);
  }

  // Get commands that require confirmation
  static getConfirmationCommands(): VoiceCommand[] {
    return this.getAllCommands().filter(cmd => cmd.requiresConfirmation);
  }

  // Get commands for specific context
  static getCommandsForContext(context: string): VoiceCommand[] {
    return this.getAllCommands().filter(cmd => 
      !cmd.context || cmd.context.includes(context)
    );
  }
}
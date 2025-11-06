# ATC Assistant System

AI-powered air traffic control assistant system for Newark Liberty International Airport (EWR), leveraging OpenAI's API and open-sourced ATC radio technology.

## Features

- Real-time radio transcription and phraseology compliance checking
- AI-powered conflict detection and resolution suggestions
- Automated flight strip management
- Runway and taxiway optimization
- Weather-integrated decision support
- Seamless integration with existing ATC systems

## Prerequisites

- Node.js 18+ and npm
- InfluxDB 2.0+ (for time-series aircraft data)
- MongoDB 6.0+ (for flight strips and communications)
- Redis 6.0+ (for caching and real-time data)
- OpenAI API key

## Installation

1. Clone the repository
2. Install dependencies:
   ```bash
   npm install
   ```

3. Copy environment configuration:
   ```bash
   cp .env.example .env
   ```

4. Configure your environment variables in `.env`:
   - Set your OpenAI API key
   - Configure database connections
   - Adjust system parameters as needed

## Development

```bash
# Build the project
npm run build

# Run in development mode
npm run dev

# Run tests
npm run test

# Lint code
npm run lint
```

## Configuration

The system uses environment variables for configuration. Key settings include:

- **OpenAI**: API key and model selection
- **Databases**: Connection strings for InfluxDB, MongoDB, and Redis
- **Airport**: Runway and frequency configuration for EWR
- **Alerts**: Timing and retention settings

## Architecture

The system follows a microservices architecture with:

- **Data Ingestion Layer**: Radar, radio, and weather data processing
- **OpenAI Processing Engine**: Speech-to-text and natural language processing
- **Core ATC Services**: Conflict detection, flight strip management, runway optimization
- **Alert Management**: Prioritized notification system
- **Controller Interface**: Multi-modal user interface

## Safety and Reliability

- Graceful degradation when AI services are unavailable
- Comprehensive error handling and logging
- Health monitoring and automatic failover
- Compliance with aviation safety standards

## License

MIT License - see LICENSE file for details.

https://medium.com/@hamdan12mohd12/an-ai-co-pilot-for-air-traffic-controllers-532a749e9e47
import { IService, ILogger, IConfigService } from '../interfaces/IService';
import { EventEmitter } from '../core/EventEmitter';
import { Aircraft, Alert, Conflict, FlightStrip } from '../types';

export interface OverlayConfig {
  position: OverlayPosition;
  size: OverlaySize;
  transparency: number; // 0-1
  zIndex: number;
  isResizable: boolean;
  isDraggable: boolean;
  isVisible: boolean;
  theme: 'light' | 'dark' | 'high-contrast';
}

export interface OverlayPosition {
  x: number;
  y: number;
  anchor: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right' | 'center';
}

export interface OverlaySize {
  width: number;
  height: number;
  minWidth?: number;
  minHeight?: number;
  maxWidth?: number;
  maxHeight?: number;
}

export interface OverlayPanel {
  id: string;
  type: PanelType;
  title: string;
  config: OverlayConfig;
  content: HTMLElement;
  isActive: boolean;
  lastUpdate: Date;
}

export enum PanelType {
  AIRCRAFT_LIST = 'AIRCRAFT_LIST',
  ALERT_PANEL = 'ALERT_PANEL',
  WEATHER_DISPLAY = 'WEATHER_DISPLAY',
  CONFLICT_MONITOR = 'CONFLICT_MONITOR',
  FLIGHT_STRIPS = 'FLIGHT_STRIPS',
  COMMUNICATION_LOG = 'COMMUNICATION_LOG',
  SYSTEM_STATUS = 'SYSTEM_STATUS',
  RADAR_OVERLAY = 'RADAR_OVERLAY'
}

export interface DisplayMetrics {
  screenWidth: number;
  screenHeight: number;
  dpi: number;
  colorDepth: number;
  refreshRate: number;
}

export interface UserPreferences {
  controllerId: string;
  panelConfigurations: { [panelId: string]: OverlayConfig };
  keyboardShortcuts: { [action: string]: string };
  alertSettings: AlertDisplaySettings;
  colorScheme: ColorScheme;
  fontSize: number;
  autoHideInactive: boolean;
  updateFrequency: number; // milliseconds
}

export interface AlertDisplaySettings {
  showCritical: boolean;
  showHigh: boolean;
  showMedium: boolean;
  showLow: boolean;
  blinkCritical: boolean;
  soundEnabled: boolean;
  autoAcknowledge: boolean;
  displayDuration: number; // seconds
}

export interface ColorScheme {
  primary: string;
  secondary: string;
  background: string;
  text: string;
  alert: string;
  warning: string;
  success: string;
  accent: string;
}

export class DisplayOverlaySystem implements IService {
  private logger: ILogger;
  private config: IConfigService;
  private eventEmitter: EventEmitter;
  private overlayPanels = new Map<string, OverlayPanel>();
  private userPreferences: UserPreferences;
  private displayMetrics: DisplayMetrics;
  private isInitialized = false;
  private updateInterval?: NodeJS.Timer;
  private overlayContainer?: HTMLElement;

  // Default color schemes
  private colorSchemes = new Map<string, ColorScheme>([
    ['light', {
      primary: '#2563eb',
      secondary: '#64748b',
      background: '#ffffff',
      text: '#1e293b',
      alert: '#dc2626',
      warning: '#f59e0b',
      success: '#16a34a',
      accent: '#7c3aed'
    }],
    ['dark', {
      primary: '#3b82f6',
      secondary: '#94a3b8',
      background: '#0f172a',
      text: '#f1f5f9',
      alert: '#ef4444',
      warning: '#fbbf24',
      success: '#22c55e',
      accent: '#8b5cf6'
    }],
    ['high-contrast', {
      primary: '#ffffff',
      secondary: '#cccccc',
      background: '#000000',
      text: '#ffffff',
      alert: '#ff0000',
      warning: '#ffff00',
      success: '#00ff00',
      accent: '#00ffff'
    }]
  ]);

  constructor(
    logger: ILogger,
    config: IConfigService,
    eventEmitter: EventEmitter
  ) {
    this.logger = logger;
    this.config = config;
    this.eventEmitter = eventEmitter;
    
    this.displayMetrics = this.detectDisplayMetrics();
    this.userPreferences = this.loadDefaultPreferences();
  }

  async initialize(): Promise<void> {
    try {
      // Create overlay container
      this.createOverlayContainer();
      
      // Load user preferences
      await this.loadUserPreferences();
      
      // Initialize default panels
      this.initializeDefaultPanels();
      
      // Set up event listeners
      this.setupEventListeners();
      
      // Start update cycle
      this.startUpdateCycle();
      
      this.isInitialized = true;
      this.logger.info('Display Overlay System initialized successfully');
    } catch (error) {
      this.logger.error('Display Overlay System initialization failed', error as Error);
      throw error;
    }
  }

  async shutdown(): Promise<void> {
    this.isInitialized = false;
    
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
    }
    
    // Save user preferences
    await this.saveUserPreferences();
    
    // Remove overlay container
    if (this.overlayContainer) {
      document.body.removeChild(this.overlayContainer);
    }
    
    this.overlayPanels.clear();
    this.logger.info('Display Overlay System shutdown completed');
  }

  async isHealthy(): Promise<boolean> {
    return this.isInitialized && this.overlayContainer !== undefined;
  }

  // Create a new overlay panel
  createPanel(type: PanelType, config?: Partial<OverlayConfig>): string {
    const panelId = `panel_${type}_${Date.now()}`;
    
    const defaultConfig: OverlayConfig = {
      position: { x: 100, y: 100, anchor: 'top-left' },
      size: { width: 300, height: 200, minWidth: 200, minHeight: 150 },
      transparency: 0.1,
      zIndex: 1000,
      isResizable: true,
      isDraggable: true,
      isVisible: true,
      theme: 'dark'
    };
    
    const panelConfig = { ...defaultConfig, ...config };
    const content = this.createPanelContent(type);
    
    const panel: OverlayPanel = {
      id: panelId,
      type,
      title: this.getPanelTitle(type),
      config: panelConfig,
      content,
      isActive: true,
      lastUpdate: new Date()
    };
    
    this.overlayPanels.set(panelId, panel);
    this.renderPanel(panel);
    
    this.logger.info('Created overlay panel', {
      panelId,
      type,
      position: panelConfig.position,
      size: panelConfig.size
    });
    
    this.eventEmitter.emit('overlay:panel_created', { panelId, panel });
    
    return panelId;
  }

  // Update panel content
  updatePanel(panelId: string, data: any): void {
    const panel = this.overlayPanels.get(panelId);
    if (!panel) {
      this.logger.warn(`Panel ${panelId} not found for update`);
      return;
    }
    
    try {
      this.updatePanelContent(panel, data);
      panel.lastUpdate = new Date();
      
      this.eventEmitter.emit('overlay:panel_updated', { panelId, data });
    } catch (error) {
      this.logger.error(`Failed to update panel ${panelId}`, error as Error);
    }
  }

  // Show/hide panel
  togglePanel(panelId: string, visible?: boolean): void {
    const panel = this.overlayPanels.get(panelId);
    if (!panel) return;
    
    panel.config.isVisible = visible !== undefined ? visible : !panel.config.isVisible;
    
    const element = document.getElementById(panelId);
    if (element) {
      element.style.display = panel.config.isVisible ? 'block' : 'none';
    }
    
    this.eventEmitter.emit('overlay:panel_toggled', { panelId, visible: panel.config.isVisible });
  }

  // Remove panel
  removePanel(panelId: string): void {
    const panel = this.overlayPanels.get(panelId);
    if (!panel) return;
    
    const element = document.getElementById(panelId);
    if (element && element.parentNode) {
      element.parentNode.removeChild(element);
    }
    
    this.overlayPanels.delete(panelId);
    
    this.logger.info('Removed overlay panel', { panelId });
    this.eventEmitter.emit('overlay:panel_removed', { panelId });
  }

  // Update panel configuration
  updatePanelConfig(panelId: string, config: Partial<OverlayConfig>): void {
    const panel = this.overlayPanels.get(panelId);
    if (!panel) return;
    
    panel.config = { ...panel.config, ...config };
    this.applyPanelConfig(panel);
    
    this.eventEmitter.emit('overlay:panel_configured', { panelId, config });
  }

  // Get all panels
  getPanels(): OverlayPanel[] {
    return Array.from(this.overlayPanels.values());
  }

  // Get panel by ID
  getPanel(panelId: string): OverlayPanel | null {
    return this.overlayPanels.get(panelId) || null;
  }

  // Update user preferences
  updateUserPreferences(preferences: Partial<UserPreferences>): void {
    this.userPreferences = { ...this.userPreferences, ...preferences };
    this.applyUserPreferences();
    
    this.eventEmitter.emit('overlay:preferences_updated', { preferences: this.userPreferences });
  }

  // Get current user preferences
  getUserPreferences(): UserPreferences {
    return { ...this.userPreferences };
  }

  // Show alert on overlay
  showAlert(alert: Alert): void {
    const alertPanelId = this.findPanelByType(PanelType.ALERT_PANEL);
    if (alertPanelId) {
      this.updatePanel(alertPanelId, { alert });
    } else {
      // Create alert panel if it doesn't exist
      const panelId = this.createPanel(PanelType.ALERT_PANEL, {
        position: { x: 50, y: 50, anchor: 'top-right' },
        size: { width: 350, height: 150 }
      });
      this.updatePanel(panelId, { alert });
    }
    
    // Handle alert display settings
    if (this.userPreferences.alertSettings.blinkCritical && alert.severity === 'CRITICAL') {
      this.blinkPanel(alertPanelId || '');
    }
  }

  // Update aircraft display
  updateAircraftDisplay(aircraft: Aircraft[]): void {
    const aircraftPanelId = this.findPanelByType(PanelType.AIRCRAFT_LIST);
    if (aircraftPanelId) {
      this.updatePanel(aircraftPanelId, { aircraft });
    }
  }

  // Update conflict display
  updateConflictDisplay(conflicts: Conflict[]): void {
    const conflictPanelId = this.findPanelByType(PanelType.CONFLICT_MONITOR);
    if (conflictPanelId) {
      this.updatePanel(conflictPanelId, { conflicts });
    }
  }

  // Private helper methods
  private createOverlayContainer(): void {
    this.overlayContainer = document.createElement('div');
    this.overlayContainer.id = 'atc-overlay-container';
    this.overlayContainer.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      pointer-events: none;
      z-index: 10000;
      font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
    `;
    
    document.body.appendChild(this.overlayContainer);
  }

  private detectDisplayMetrics(): DisplayMetrics {
    return {
      screenWidth: window.screen.width,
      screenHeight: window.screen.height,
      dpi: window.devicePixelRatio * 96,
      colorDepth: window.screen.colorDepth,
      refreshRate: 60 // Default, actual detection would require additional APIs
    };
  }

  private loadDefaultPreferences(): UserPreferences {
    return {
      controllerId: 'default',
      panelConfigurations: {},
      keyboardShortcuts: {
        'toggle_alerts': 'F1',
        'toggle_aircraft': 'F2',
        'toggle_weather': 'F3',
        'acknowledge_alert': 'Space'
      },
      alertSettings: {
        showCritical: true,
        showHigh: true,
        showMedium: true,
        showLow: false,
        blinkCritical: true,
        soundEnabled: true,
        autoAcknowledge: false,
        displayDuration: 30
      },
      colorScheme: this.colorSchemes.get('dark')!,
      fontSize: 14,
      autoHideInactive: false,
      updateFrequency: 1000
    };
  }

  private async loadUserPreferences(): Promise<void> {
    try {
      // In real implementation, this would load from database or local storage
      const saved = localStorage.getItem('atc_overlay_preferences');
      if (saved) {
        const preferences = JSON.parse(saved);
        this.userPreferences = { ...this.userPreferences, ...preferences };
      }
    } catch (error) {
      this.logger.warn('Failed to load user preferences', { error: (error as Error).message });
    }
  }

  private async saveUserPreferences(): Promise<void> {
    try {
      localStorage.setItem('atc_overlay_preferences', JSON.stringify(this.userPreferences));
    } catch (error) {
      this.logger.warn('Failed to save user preferences', { error: (error as Error).message });
    }
  }

  private initializeDefaultPanels(): void {
    // Create default panels based on configuration
    const defaultPanels = [
      { type: PanelType.ALERT_PANEL, position: { x: 20, y: 20 } },
      { type: PanelType.AIRCRAFT_LIST, position: { x: 20, y: 200 } },
      { type: PanelType.SYSTEM_STATUS, position: { x: 20, y: 500 } }
    ];
    
    for (const panelDef of defaultPanels) {
      this.createPanel(panelDef.type, {
        position: { ...panelDef.position, anchor: 'top-left' }
      });
    }
  }

  private setupEventListeners(): void {
    // Set up keyboard shortcuts
    document.addEventListener('keydown', (event) => {
      this.handleKeyboardShortcut(event);
    });
    
    // Set up window resize handler
    window.addEventListener('resize', () => {
      this.handleWindowResize();
    });
  }

  private handleKeyboardShortcut(event: KeyboardEvent): void {
    const shortcut = this.getKeyboardShortcut(event);
    const action = Object.entries(this.userPreferences.keyboardShortcuts)
      .find(([_, key]) => key === shortcut)?.[0];
    
    if (action) {
      event.preventDefault();
      this.executeShortcutAction(action);
    }
  }

  private getKeyboardShortcut(event: KeyboardEvent): string {
    const parts: string[] = [];
    if (event.ctrlKey) parts.push('Ctrl');
    if (event.altKey) parts.push('Alt');
    if (event.shiftKey) parts.push('Shift');
    parts.push(event.key);
    return parts.join('+');
  }

  private executeShortcutAction(action: string): void {
    switch (action) {
      case 'toggle_alerts':
        const alertPanel = this.findPanelByType(PanelType.ALERT_PANEL);
        if (alertPanel) this.togglePanel(alertPanel);
        break;
      case 'toggle_aircraft':
        const aircraftPanel = this.findPanelByType(PanelType.AIRCRAFT_LIST);
        if (aircraftPanel) this.togglePanel(aircraftPanel);
        break;
      case 'acknowledge_alert':
        this.eventEmitter.emit('overlay:acknowledge_alert');
        break;
    }
  }

  private handleWindowResize(): void {
    this.displayMetrics = this.detectDisplayMetrics();
    
    // Adjust panel positions if they're outside the new viewport
    for (const panel of this.overlayPanels.values()) {
      this.constrainPanelToViewport(panel);
    }
  }

  private constrainPanelToViewport(panel: OverlayPanel): void {
    const element = document.getElementById(panel.id);
    if (!element) return;
    
    const rect = element.getBoundingClientRect();
    let { x, y } = panel.config.position;
    
    // Ensure panel is within viewport
    if (rect.right > window.innerWidth) {
      x = window.innerWidth - panel.config.size.width - 20;
    }
    if (rect.bottom > window.innerHeight) {
      y = window.innerHeight - panel.config.size.height - 20;
    }
    if (x < 0) x = 20;
    if (y < 0) y = 20;
    
    if (x !== panel.config.position.x || y !== panel.config.position.y) {
      panel.config.position.x = x;
      panel.config.position.y = y;
      this.applyPanelConfig(panel);
    }
  }

  private createPanelContent(type: PanelType): HTMLElement {
    const content = document.createElement('div');
    content.className = 'panel-content';
    
    switch (type) {
      case PanelType.ALERT_PANEL:
        content.innerHTML = `
          <div class="alert-container">
            <div class="alert-header">System Alerts</div>
            <div class="alert-list" id="alert-list"></div>
          </div>
        `;
        break;
        
      case PanelType.AIRCRAFT_LIST:
        content.innerHTML = `
          <div class="aircraft-container">
            <div class="aircraft-header">Active Aircraft</div>
            <div class="aircraft-list" id="aircraft-list"></div>
          </div>
        `;
        break;
        
      case PanelType.SYSTEM_STATUS:
        content.innerHTML = `
          <div class="status-container">
            <div class="status-header">System Status</div>
            <div class="status-indicators" id="status-indicators"></div>
          </div>
        `;
        break;
        
      default:
        content.innerHTML = `<div class="default-panel">Panel: ${type}</div>`;
    }
    
    return content;
  }

  private renderPanel(panel: OverlayPanel): void {
    const element = document.createElement('div');
    element.id = panel.id;
    element.className = 'atc-overlay-panel';
    
    // Create panel structure
    element.innerHTML = `
      <div class="panel-header">
        <span class="panel-title">${panel.title}</span>
        <div class="panel-controls">
          <button class="panel-minimize">−</button>
          <button class="panel-close">×</button>
        </div>
      </div>
      <div class="panel-body"></div>
    `;
    
    // Add content
    const body = element.querySelector('.panel-body') as HTMLElement;
    body.appendChild(panel.content);
    
    // Apply configuration
    this.applyPanelConfig(panel, element);
    
    // Add event listeners
    this.addPanelEventListeners(element, panel);
    
    // Add to container
    if (this.overlayContainer) {
      this.overlayContainer.appendChild(element);
    }
  }

  private applyPanelConfig(panel: OverlayPanel, element?: HTMLElement): void {
    const el = element || document.getElementById(panel.id);
    if (!el) return;
    
    const config = panel.config;
    const colorScheme = this.userPreferences.colorScheme;
    
    el.style.cssText = `
      position: absolute;
      left: ${config.position.x}px;
      top: ${config.position.y}px;
      width: ${config.size.width}px;
      height: ${config.size.height}px;
      background: ${colorScheme.background};
      border: 1px solid ${colorScheme.secondary};
      border-radius: 4px;
      box-shadow: 0 4px 12px rgba(0,0,0,0.3);
      opacity: ${1 - config.transparency};
      z-index: ${config.zIndex};
      display: ${config.isVisible ? 'block' : 'none'};
      pointer-events: auto;
      font-size: ${this.userPreferences.fontSize}px;
      color: ${colorScheme.text};
      resize: ${config.isResizable ? 'both' : 'none'};
      overflow: hidden;
    `;
  }

  private addPanelEventListeners(element: HTMLElement, panel: OverlayPanel): void {
    // Make draggable
    if (panel.config.isDraggable) {
      this.makeDraggable(element, panel);
    }
    
    // Panel controls
    const minimizeBtn = element.querySelector('.panel-minimize') as HTMLElement;
    const closeBtn = element.querySelector('.panel-close') as HTMLElement;
    
    minimizeBtn?.addEventListener('click', () => {
      this.togglePanel(panel.id);
    });
    
    closeBtn?.addEventListener('click', () => {
      this.removePanel(panel.id);
    });
  }

  private makeDraggable(element: HTMLElement, panel: OverlayPanel): void {
    const header = element.querySelector('.panel-header') as HTMLElement;
    let isDragging = false;
    let startX = 0;
    let startY = 0;
    
    header.style.cursor = 'move';
    
    header.addEventListener('mousedown', (e) => {
      isDragging = true;
      startX = e.clientX - panel.config.position.x;
      startY = e.clientY - panel.config.position.y;
      
      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
    });
    
    const onMouseMove = (e: MouseEvent) => {
      if (!isDragging) return;
      
      panel.config.position.x = e.clientX - startX;
      panel.config.position.y = e.clientY - startY;
      
      element.style.left = panel.config.position.x + 'px';
      element.style.top = panel.config.position.y + 'px';
    };
    
    const onMouseUp = () => {
      isDragging = false;
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };
  }

  private updatePanelContent(panel: OverlayPanel, data: any): void {
    switch (panel.type) {
      case PanelType.ALERT_PANEL:
        this.updateAlertPanel(panel, data);
        break;
      case PanelType.AIRCRAFT_LIST:
        this.updateAircraftPanel(panel, data);
        break;
      case PanelType.SYSTEM_STATUS:
        this.updateStatusPanel(panel, data);
        break;
    }
  }

  private updateAlertPanel(panel: OverlayPanel, data: { alert?: Alert }): void {
    const alertList = panel.content.querySelector('#alert-list') as HTMLElement;
    if (!alertList || !data.alert) return;
    
    const alertElement = document.createElement('div');
    alertElement.className = `alert-item alert-${data.alert.severity.toLowerCase()}`;
    alertElement.innerHTML = `
      <div class="alert-time">${data.alert.timestamp.toLocaleTimeString()}</div>
      <div class="alert-message">${data.alert.message}</div>
      <div class="alert-severity">${data.alert.severity}</div>
    `;
    
    alertList.insertBefore(alertElement, alertList.firstChild);
    
    // Remove old alerts (keep last 10)
    while (alertList.children.length > 10) {
      alertList.removeChild(alertList.lastChild!);
    }
  }

  private updateAircraftPanel(panel: OverlayPanel, data: { aircraft?: Aircraft[] }): void {
    const aircraftList = panel.content.querySelector('#aircraft-list') as HTMLElement;
    if (!aircraftList || !data.aircraft) return;
    
    aircraftList.innerHTML = '';
    
    for (const aircraft of data.aircraft) {
      const aircraftElement = document.createElement('div');
      aircraftElement.className = 'aircraft-item';
      aircraftElement.innerHTML = `
        <div class="aircraft-callsign">${aircraft.callsign}</div>
        <div class="aircraft-altitude">${aircraft.altitude}ft</div>
        <div class="aircraft-status">${aircraft.status}</div>
      `;
      aircraftList.appendChild(aircraftElement);
    }
  }

  private updateStatusPanel(panel: OverlayPanel, data: any): void {
    const statusIndicators = panel.content.querySelector('#status-indicators') as HTMLElement;
    if (!statusIndicators) return;
    
    statusIndicators.innerHTML = `
      <div class="status-item">
        <span class="status-label">System:</span>
        <span class="status-value status-ok">Online</span>
      </div>
      <div class="status-item">
        <span class="status-label">Radar:</span>
        <span class="status-value status-ok">Active</span>
      </div>
      <div class="status-item">
        <span class="status-label">Weather:</span>
        <span class="status-value status-ok">Current</span>
      </div>
    `;
  }

  private getPanelTitle(type: PanelType): string {
    const titles = {
      [PanelType.AIRCRAFT_LIST]: 'Aircraft List',
      [PanelType.ALERT_PANEL]: 'System Alerts',
      [PanelType.WEATHER_DISPLAY]: 'Weather Display',
      [PanelType.CONFLICT_MONITOR]: 'Conflict Monitor',
      [PanelType.FLIGHT_STRIPS]: 'Flight Strips',
      [PanelType.COMMUNICATION_LOG]: 'Communications',
      [PanelType.SYSTEM_STATUS]: 'System Status',
      [PanelType.RADAR_OVERLAY]: 'Radar Overlay'
    };
    
    return titles[type] || 'Unknown Panel';
  }

  private findPanelByType(type: PanelType): string | null {
    for (const [id, panel] of this.overlayPanels) {
      if (panel.type === type) {
        return id;
      }
    }
    return null;
  }

  private blinkPanel(panelId: string): void {
    const element = document.getElementById(panelId);
    if (!element) return;
    
    let blinkCount = 0;
    const blinkInterval = setInterval(() => {
      element.style.opacity = element.style.opacity === '0.5' ? '1' : '0.5';
      blinkCount++;
      
      if (blinkCount >= 6) { // Blink 3 times
        clearInterval(blinkInterval);
        element.style.opacity = '1';
      }
    }, 250);
  }

  private applyUserPreferences(): void {
    // Apply color scheme and font size to all panels
    for (const panel of this.overlayPanels.values()) {
      this.applyPanelConfig(panel);
    }
  }

  private startUpdateCycle(): void {
    this.updateInterval = setInterval(() => {
      // Update panel positions and visibility based on preferences
      if (this.userPreferences.autoHideInactive) {
        this.hideInactivePanels();
      }
    }, this.userPreferences.updateFrequency);
  }

  private hideInactivePanels(): void {
    const inactiveThreshold = 5 * 60 * 1000; // 5 minutes
    const now = new Date();
    
    for (const panel of this.overlayPanels.values()) {
      const timeSinceUpdate = now.getTime() - panel.lastUpdate.getTime();
      if (timeSinceUpdate > inactiveThreshold && panel.config.isVisible) {
        this.togglePanel(panel.id, false);
      }
    }
  }
}
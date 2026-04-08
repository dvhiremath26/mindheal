import { describe, it, expect } from 'vitest';
import {
  isDynamicId,
  detectPlatform,
  extractStableIdPart,
} from '../../src/core/enterprise-strategy';

// ─── Dynamic ID Detection ───────────────────────────────────────────────────

describe('isDynamicId', () => {
  describe('SAP UI5 / Fiori', () => {
    it('should detect SAP XML View prefixes', () => {
      expect(isDynamicId('__xmlview0--loginButton')).toBe(true);
      expect(isDynamicId('__xmlview123--submitBtn')).toBe(true);
    });

    it('should detect SAP Component prefixes', () => {
      expect(isDynamicId('__component0---app--mainView')).toBe(true);
    });

    it('should detect SAP Control IDs', () => {
      expect(isDynamicId('__control0-combobox')).toBe(true);
    });

    it('should detect SAP clone suffixes', () => {
      expect(isDynamicId('myItem-__clone42')).toBe(true);
    });
  });

  describe('Salesforce', () => {
    it('should detect Salesforce Global IDs', () => {
      expect(isDynamicId('globalId_12345')).toBe(true);
    });

    it('should detect Salesforce Aura IDs', () => {
      expect(isDynamicId('auraId_67890')).toBe(true);
    });

    it('should detect Salesforce component hashes', () => {
      expect(isDynamicId('cmpAbCdEfGhIjKl')).toBe(true);
    });
  });

  describe('Oracle', () => {
    it('should detect Oracle PeopleSoft prefixes', () => {
      expect(isDynamicId('pt1_23_panelHeader')).toBe(true);
    });

    it('should detect Oracle Forms numeric IDs', () => {
      expect(isDynamicId('N12345678')).toBe(true);
    });
  });

  describe('Workday', () => {
    it('should detect Workday widget prefixes', () => {
      expect(isDynamicId('wd-AbCdEfGh12-dateField')).toBe(true);
    });
  });

  describe('ServiceNow', () => {
    it('should detect ServiceNow SysIDs', () => {
      expect(isDynamicId('sys_12345678901234567890123456789012')).toBe(true);
    });
  });

  describe('Dynamics 365', () => {
    it('should detect Dynamics GUID prefixes', () => {
      expect(isDynamicId('id-12345678-abcd')).toBe(true);
    });
  });

  describe('Generic patterns', () => {
    it('should detect UUID v4', () => {
      expect(isDynamicId('a1b2c3d4-e5f6-7890-abcd-ef1234567890')).toBe(true);
    });

    it('should detect long hex hashes', () => {
      expect(isDynamicId('abcdef0123456789abcdef0123456789')).toBe(true);
    });

    it('should detect Ember auto-generated IDs', () => {
      expect(isDynamicId('ember123')).toBe(true);
    });

    it('should detect React Select IDs', () => {
      expect(isDynamicId('react-select-5-option-3')).toBe(true);
    });

    it('should detect timestamp suffixes', () => {
      expect(isDynamicId('element_1712345678901')).toBe(true);
    });
  });

  describe('Stable IDs (should NOT be detected)', () => {
    it('should not flag simple stable IDs', () => {
      expect(isDynamicId('loginButton')).toBe(false);
      expect(isDynamicId('submit-form')).toBe(false);
      expect(isDynamicId('header-nav')).toBe(false);
      expect(isDynamicId('search-input')).toBe(false);
    });

    it('should not flag short IDs', () => {
      expect(isDynamicId('btn')).toBe(false);
      expect(isDynamicId('main')).toBe(false);
    });
  });
});

// ─── Stable ID Part Extraction ──────────────────────────────────────────────

describe('extractStableIdPart', () => {
  it('should extract stable part from SAP XML View IDs', () => {
    expect(extractStableIdPart('__xmlview0--loginButton')).toBe('loginButton');
    expect(extractStableIdPart('__xmlview123--submitBtn')).toBe('submitBtn');
  });

  it('should extract stable part from SAP Component IDs', () => {
    expect(extractStableIdPart('__component0---mainView')).toBe('mainView');
  });

  it('should return null for IDs with no meaningful stable part', () => {
    expect(extractStableIdPart('__control0-')).toBeNull();
    expect(extractStableIdPart('loginButton')).toBeNull(); // Not dynamic
  });

  it('should return null for non-dynamic IDs', () => {
    expect(extractStableIdPart('header-nav')).toBeNull();
    expect(extractStableIdPart('search-input')).toBeNull();
  });
});

// ─── Platform Detection ─────────────────────────────────────────────────────

describe('detectPlatform', () => {
  describe('URL-based detection', () => {
    it('should detect Salesforce from URL', () => {
      expect(detectPlatform('https://myorg.lightning.force.com/one/one.app', '')).toBe('salesforce');
      expect(detectPlatform('https://myorg.my.salesforce.com/home/home.jsp', '')).toBe('salesforce');
    });

    it('should detect SAP from URL', () => {
      expect(detectPlatform('https://mycompany.sapcloud.io/sap/bc/ui5', '')).toBe('sap');
      expect(detectPlatform('https://launchpad.example.com/fiorilaunchpad', '')).toBe('sap');
    });

    it('should detect Oracle from URL', () => {
      expect(detectPlatform('https://myorg.oraclecloud.com/fscmUI/faces', '')).toBe('oracle');
      expect(detectPlatform('https://account.netsuite.com/app/center', '')).toBe('oracle');
    });

    it('should detect Workday from URL', () => {
      expect(detectPlatform('https://wd5.myworkday.com/mycompany/d/home.htmld', '')).toBe('workday');
    });

    it('should detect ServiceNow from URL', () => {
      expect(detectPlatform('https://mycompany.service-now.com/nav_to.do', '')).toBe('servicenow');
    });

    it('should detect Dynamics 365 from URL', () => {
      expect(detectPlatform('https://myorg.crm.dynamics.com/main.aspx', '')).toBe('dynamics');
    });
  });

  describe('DOM-based detection', () => {
    it('should detect Salesforce from DOM content', () => {
      expect(detectPlatform('https://example.com', '<lightning-button data-aura-rendered-by="123">')).toBe('salesforce');
    });

    it('should detect SAP from DOM content', () => {
      expect(detectPlatform('https://example.com', '<div data-sap-ui="root"><ui5-button>Click</ui5-button></div>')).toBe('sap');
    });

    it('should detect ServiceNow from DOM content', () => {
      expect(detectPlatform('https://example.com', '<now-button><sn-card data-table-name="incident">')).toBe('servicenow');
    });

    it('should detect Workday from DOM content', () => {
      expect(detectPlatform('https://example.com', '<div data-automation-id="loginButton" data-uxi-widget-type="button">')).toBe('workday');
    });
  });

  describe('Unknown platforms', () => {
    it('should return null for generic pages', () => {
      expect(detectPlatform('https://example.com', '<div><button>Click</button></div>')).toBeNull();
    });
  });
});

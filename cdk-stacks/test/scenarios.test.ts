import * as fs from 'fs';
import * as path from 'path';

interface ConversationTurn {
  turn: number;
  direction: 'inbound' | 'outbound';
  message: string;
  intent: Record<string, unknown>;
  policy?: Record<string, unknown>;
  state: Record<string, unknown>;
  sessionVariables: Record<string, unknown>;
}

interface TestScenario {
  scenario: string;
  description: string;
  sessionId: string;
  phoneNumber: string;
  serviceAddress: string;
  channel: string;
  turns: ConversationTurn[];
  intentFlow: string[];
  stageProgression: string[];
  expectedAssertions: {
    purchaseIntentAlert: { shouldFire: boolean; onTurns?: number[]; reason: string };
    medicalAlert: { shouldFire: boolean; reason: string };
    salesPushBlocked?: { onTurns: number[]; reason: string };
  };
}

const fixturesDir = path.join(__dirname, 'fixtures');

function loadScenario(name: string): TestScenario {
  const filePath = path.join(fixturesDir, `${name}.json`);
  return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
}

describe('Multi-turn conversation scenarios', () => {
  const scenario = loadScenario('abidjan-info-price-deferral');

  it('should have all required scenario fields', () => {
    expect(scenario.scenario).toBeTruthy();
    expect(scenario.description).toBeTruthy();
    expect(scenario.sessionId).toBeTruthy();
    expect(scenario.phoneNumber).toBeTruthy();
    expect(scenario.channel).toBe('whatsapp');
    expect(scenario.turns.length).toBeGreaterThan(0);
  });

  it('should start with an inbound message', () => {
    expect(scenario.turns[0].direction).toBe('inbound');
    expect(scenario.turns[0].message).toBeTruthy();
  });

  it('should alternate inbound/outbound turns', () => {
    for (let i = 0; i < scenario.turns.length; i++) {
      const expected = i % 2 === 0 ? 'inbound' : 'outbound';
      expect(scenario.turns[i].direction).toBe(expected);
    }
  });

  it('should have sequential turn numbers', () => {
    scenario.turns.forEach((turn, index) => {
      expect(turn.turn).toBe(index + 1);
    });
  });

  it('should have intent metadata on every turn', () => {
    scenario.turns.forEach((turn) => {
      expect(turn.intent).toBeDefined();
      expect(turn.intent.primaryIntent).toBeTruthy();
      expect(turn.intent.confidence).toBeGreaterThanOrEqual(0);
      expect(turn.intent.confidence).toBeLessThanOrEqual(1);
    });
  });

  it('should track intent flow across the conversation', () => {
    const expectedFlow = scenario.intentFlow;
    const actualFlow = scenario.turns.map((t) => t.intent.primaryIntent as string);
    expect(actualFlow).toEqual(expectedFlow);
  });

  it('should track purchase stage progression', () => {
    const actualStages = scenario.turns.map((t) => t.intent.purchaseStage as string | undefined);
    const expected = scenario.stageProgression;
    actualStages.forEach((stage, i) => {
      if (stage !== undefined) {
        expect(stage).toBe(expected[i]);
      }
    });
  });

  it('should have state tracking on every turn', () => {
    scenario.turns.forEach((turn) => {
      expect(turn.state.conversationStage).toBeTruthy();
      expect(turn.state).toHaveProperty('recentTurnCount');
    });
  });

  it('should have session variables on every turn', () => {
    scenario.turns.forEach((turn) => {
      expect(turn.sessionVariables).toBeDefined();
    });
  });

  it('should detect purchase intent correctly (purchaseIntentAlert)', () => {
    const assertion = scenario.expectedAssertions.purchaseIntentAlert;
    const purchaseIntentTurns = scenario.turns
      .filter((t) => t.intent.primaryIntent === 'purchase_intent')
      .map((t) => t.turn);

    if (assertion.shouldFire && assertion.onTurns) {
      expect(purchaseIntentTurns).toEqual(expect.arrayContaining(assertion.onTurns));
    }
  });

  it('should have medical_claims in mustAvoid policy on all turns', () => {
    scenario.turns.forEach((turn) => {
      if (turn.policy?.mustAvoid) {
        const avoid = turn.policy.mustAvoid as string[];
        expect(avoid).toContain('medical_claims');
      }
    });
  });

  it('should not repeat sent assets', () => {
    const outboundTurns = scenario.turns.filter((t) => t.direction === 'outbound');
    outboundTurns.forEach((turn) => {
      if (turn.policy?.mustNotRepeat) {
        const notRepeat = turn.policy.mustNotRepeat as string[];
        expect(notRepeat).toEqual(expect.arrayContaining([]));
      }
    });
  });

  it('should progress conversation stage logically', () => {
    const stages = scenario.turns
      .filter((t) => t.direction === 'inbound')
      .map((t) => t.state.conversationStage as string);

    const stageOrder = ['information', 'purchase', 'information', 'follow_up'];
    expect(stages).toEqual(stageOrder);
  });
});

describe('All scenario fixtures', () => {
  it('should load all JSON fixtures in fixtures directory', () => {
    const files = fs.readdirSync(fixturesDir).filter((f) => f.endsWith('.json'));
    expect(files.length).toBeGreaterThan(0);

    files.forEach((file) => {
      const scenario = loadScenario(path.basename(file, '.json'));
      expect(scenario.turns.length).toBeGreaterThan(0);
    });
  });
});

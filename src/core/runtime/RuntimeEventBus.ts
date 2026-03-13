import type { GoalControlState, ToolControlState } from '../../services/runtimeTypes';

type ToolControlNoticeSeverity = 'info' | 'warning' | 'error';

export class RuntimeEventBus {
    constructor(
        private readonly emitTurnEventImpl: (turnId: string, type: string, payload?: any) => void,
        private readonly emitToolControlStateImpl: (turnId: string, state: ToolControlState | null) => void,
        private readonly emitGoalControlStateImpl: (turnId: string, state: GoalControlState | null) => void,
        private readonly emitToolControlNoticeImpl: (
            turnId: string,
            message: string,
            severity?: ToolControlNoticeSeverity
        ) => void,
    ) {}

    public emit(turnId: string, type: string, payload: any = {}) {
        this.emitTurnEventImpl(turnId, type, payload);
    }

    public emitToolControlState(turnId: string, state: ToolControlState | null) {
        this.emitToolControlStateImpl(turnId, state);
    }

    public emitGoalControlState(turnId: string, state: GoalControlState | null) {
        this.emitGoalControlStateImpl(turnId, state);
    }

    public emitToolControlNotice(
        turnId: string,
        message: string,
        severity: ToolControlNoticeSeverity = 'warning'
    ) {
        this.emitToolControlNoticeImpl(turnId, message, severity);
    }
}

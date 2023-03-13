import { debug, Event, EventEmitter, WorkspaceFolder, DebugConfiguration, workspace } from 'vscode';
import {
	RetireEvent,
	TestAdapter,
	TestEvent,
	TestInfo,
	TestLoadFinishedEvent,
	TestLoadStartedEvent,
	TestRunFinishedEvent,
	TestRunStartedEvent,
	TestSuiteEvent,
	TestSuiteInfo
} from 'vscode-test-adapter-api';

type TestRunEvent = TestRunStartedEvent | TestRunFinishedEvent | TestSuiteEvent | TestEvent;

export class CucumberTestAdapter implements TestAdapter {
	workspaceFolder?: WorkspaceFolder | undefined;

	private disposables: { dispose(): void }[] = [];
	private readonly testsEmitter = new EventEmitter<TestLoadStartedEvent | TestLoadFinishedEvent>();
	private readonly testStatesEmitter = new EventEmitter<TestRunEvent>();
	private readonly autorunEmitter = new EventEmitter<void>();

	private readonly testsById = new Map<string, TestSuiteInfo | TestInfo>();
	private readonly testsByFsPath = new Map<string, TestSuiteInfo | TestInfo>();

	get tests(): Event<TestLoadStartedEvent | TestLoadFinishedEvent> {
		return this.testsEmitter.event;
	}

	get testStates(): Event<TestRunEvent> {
		return this.testStatesEmitter.event;
	}

	get autorun(): Event<void> {
		return this.autorunEmitter.event;
	}

	load(): Promise<void> {
		throw new Error('Method not implemented.');
	}
	run(tests: string[]): Promise<void> {
		throw new Error('Method not implemented.');
	}
	debug?(tests: string[]): Promise<void> {
		throw new Error('Method not implemented.');
	}
	cancel(): void {
		throw new Error('Method not implemented.');
	}
	retire?: Event<RetireEvent> | undefined;
}

import type { CoordinatorToWorkerCommand, WorkerToCoordinatorEvent } from './ctv-controller';
import { CtvWorker } from './ctv-worker';

function run(): void {
	const exit = (exitCode: number, error?: Error, message?: string): void => {
		if (error) {
			console.error(new Error(message, { cause: error }));
		}
		process.exit(exitCode);
	};

	const worker = new CtvWorker({
		argv: process.argv,
		cwd: process.cwd(),
		stdout: process.stdout,
		stderr: process.stderr,
		env: process.env,
		id: process.env.WORKER_ID!,
		exit,
		sendMessage: (message: WorkerToCoordinatorEvent) => process.send!(message)
	});

	process.on('message', (m: unknown): void => {
		worker
			.receiveMessage(m as CoordinatorToWorkerCommand)
			.catch((error: Error) => exit(1, error, 'Unexpected error on worker.receiveMessage'));
	});
}

run();

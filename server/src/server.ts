import {
	createConnection,
	TextDocuments,
	DiagnosticSeverity,
	Diagnostic,
	ProposedFeatures,
	InitializeParams,
	CompletionItem,
	CompletionItemKind,
	TextDocumentPositionParams,
	TextDocumentSyncKind,
	InitializeResult,
	Position,
	Hover,
	Range,
} from 'vscode-languageserver';

import {
	TextDocument
} from 'vscode-languageserver-textdocument';
import { spawn, ChildProcess } from 'child_process';

type LangServerResult = {
	status: 'OK' | 'failed';
	errors: Array<{
		lineNr: number;
		colNr: number;
		token: string;
		desc: string;
	}>;
	symbols: Array<{
		context: 'Global' | 'Local' | 'Argument' | 'Upvalue';
		lineNr: number;
		colNr: number;
		name: string;
		isConst: boolean;
		type: string;
		returnType: string;
	}>;
}

const documents: TextDocuments<TextDocument> = new TextDocuments(TextDocument);
const connection = createConnection(ProposedFeatures.all);

connection.onInitialize((_: InitializeParams) => {
	const result: InitializeResult = {
		capabilities: {
			textDocumentSync: TextDocumentSyncKind.Incremental,
			completionProvider: {
				resolveProvider: true,
			},
			hoverProvider: true,
		},
	};

	return result;
});

let documentLangServers: Map<string, ChildProcess> = new Map();
let documentHoverServers: Map<string, ChildProcess> = new Map();

documents.onDidClose(e => {
	if (documentLangServers.has(e.document.uri)) {
		const serverProcess = documentLangServers.get(e.document.uri);

		if (serverProcess) {
			serverProcess.kill('SIGINT');
		}

		documentLangServers.delete(e.document.uri);
	}
});

documents.onDidChangeContent(async change => {
	const textDocument = change.document;

	if (documentLangServers.has(textDocument.uri)) {
		const serverProcess = documentLangServers.get(textDocument.uri);

		if (serverProcess) {
			serverProcess.kill('SIGINT');
		}

		documentLangServers.delete(textDocument.uri);
	}

	const text = textDocument.getText();
	const buffer: any[] = [];

	const serverProcess = spawn('F:/Projects/qscript-language/Debug/LangSrv.exe', ['--exit']);

	if (serverProcess.pid) {
		serverProcess.stdout.on('data', (data) => {
			buffer.push(data);
		});

		serverProcess.stdout.on('end', () => {
			if (buffer.length === 0) {
				return;
			}

			const diagnostics: Diagnostic[] = [];

			const serverResult = buffer.join('');

			try {
				const serverJson: LangServerResult = JSON.parse(serverResult);

				for (const error of serverJson.errors) {
					const diagnostic: Diagnostic = {
						severity: DiagnosticSeverity.Warning,
						range: {
							start: Position.create(error.lineNr - 1, error.colNr),
							end: Position.create(error.lineNr - 1, error.colNr + error.token.length),
						},
						message: error.desc,
						source: 'Q-Script'
					};
	
					diagnostics.push(diagnostic);
				}
			} catch (err) {
				console.error(err);
			}

			connection.sendDiagnostics({ uri: textDocument.uri, diagnostics });
		});

		serverProcess.on('close', () => documentLangServers.delete(textDocument.uri));

		documentLangServers.set(textDocument.uri, serverProcess);

		serverProcess.stdin.write(text);
		serverProcess.stdin.end();
	}
});

connection.onCompletion((_: TextDocumentPositionParams): CompletionItem[] => {
	return [
		{
			label: 'const',
			kind: CompletionItemKind.Text,
			data: 1
		},
		{
			label: 'var',
			kind: CompletionItemKind.Text,
			data: 2
		}
	];
});

connection.onCompletionResolve((item: CompletionItem): CompletionItem => {
	if (item.data === 1) {
		item.detail = 'CONST';
		item.documentation = 'const - create\'s an immutable variable';
	} else if (item.data === 2) {
		item.detail = 'VAR';
		item.documentation = 'var - create\'s a mutable variable';
	}
	return item;
});

connection.onHover((textDocumentPositionParams, token) => (new Promise((resolve, reject) => {
	const textDocument = documents.get(textDocumentPositionParams.textDocument.uri);

	if (!textDocument) {
		return;
	}

	if (documentHoverServers.has(textDocument.uri)) {
		const serverProcess = documentHoverServers.get(textDocument.uri);

		if (serverProcess) {
			serverProcess.kill('SIGINT');
		}

		documentHoverServers.delete(textDocument.uri);
	}

	const text = textDocument.getText();
	const buffer: any[] = [];

	const serverProcess = spawn('F:/Projects/qscript-language/Debug/LangSrv.exe', ['--exit', '--listSymbols']);

	if (serverProcess.pid) {
		serverProcess.stdout.on('data', (data) => {
			buffer.push(data);
		});

		serverProcess.stdout.on('end', () => {
			if (buffer.length === 0) {
				return;
			}

			const serverResult = buffer.join('');
			const { position } = textDocumentPositionParams;
			let symbol = null;

			try {
				const serverJson: LangServerResult = JSON.parse(serverResult);

				for (const variable of serverJson.symbols) {
					if (position.line !== variable.lineNr - 1) {
						continue;
					}

					if (position.character >= variable.colNr && position.character <= variable.colNr + variable.name.length) {
						symbol = variable;
						break;
					}
				}
			} catch (err) {
				reject(err);
			}

			if (symbol) {
				const contents = `### ${symbol.name}
\`\`\`qscript
${symbol.isConst ? 'const' : 'var'} ${symbol.name}; // ${symbol.type}, ${symbol.context} ${symbol.type === 'function' ? `(returnType=${symbol.returnType})` : ''}
\`\`\`
`;
				resolve({
					contents,
				} as Hover);
			} else {
				resolve(null);
			}
		});

		serverProcess.on('close', () => documentHoverServers.delete(textDocument.uri));

		documentHoverServers.set(textDocument.uri, serverProcess);

		serverProcess.stdin.write(text);
		serverProcess.stdin.end();
	}
})));

documents.listen(connection);
connection.listen();

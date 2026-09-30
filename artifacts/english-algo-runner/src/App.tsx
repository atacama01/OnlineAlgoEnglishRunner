import { useEffect, useRef, useState, type ChangeEvent, type FormEvent, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  ArrowRight,
  BookOpen,
  Check,
  ChevronRight,
  CircleHelp,
  Clock3,
  Code2,
  FileCode2,
  Lightbulb,
  ListRestart,
  Play,
  RotateCcw,
  Save,
  Send,
  Settings2,
  Terminal,
  TriangleAlert,
  WandSparkles,
} from 'lucide-react';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import NotFound from '@/pages/not-found';
import { Route, Switch, useLocation, Router as WouterRouter } from 'wouter';
import { AlgoError, AlgoRunner, parseProgram, type InputRequest } from './interpreter';

const queryClient = new QueryClient();

type Value = string | number;
type OutputKind = 'system' | 'value' | 'prompt' | 'error';
type RunStatus = 'idle' | 'running' | 'waiting' | 'success' | 'error' | 'stopped';

type OutputLine = {
  kind: OutputKind;
  text: string;
};

type PendingPrompt = {
  variable: string;
  message: string;
  type: string;
};

type Example = {
  id: string;
  title: string;
  description: string;
  code: string;
  lines?: string;
};

const starterCode = `Algorithm Addition

Variables
    a, b : Integer

Begin
    a <- 5
    b <- 10
    a <- a + b
    Write("Result = ", a)
End`;

const examples: Example[] = [
  { id: 'welcome', title: 'Hello World', description: 'Your first output', code: `Algorithm HelloWorld\nBegin\n    Write("Hello, algorithm!")\nEnd` },
  { id: 'addition', title: 'Addition', description: 'Arithmetic and assignment', code: starterCode },
  { id: 'constants', title: 'Constants', description: 'Immutable typed values', code: `Algorithm ConstantsDemo\nConstants\n    MaxAttempts : Integer <- 3\n    Pi : Real <- 3.14159\nVariables\n    radius : Real\nBegin\n    radius <- 2\n    Write("Limit = ", MaxAttempts)\n    Write("Area = ", Pi * radius * radius)\nEnd` },
  { id: 'math', title: 'Math operations', description: 'Division and built-ins', code: `Algorithm MathOperations\nVariables\n    a, b, integerResult : Integer\n    realResult : Real\nBegin\n    a <- 12\n    b <- 5\n    integerResult <- a / b\n    realResult <- a / b\n    Write("Integer 12 / 5 = ", integerResult)\n    Write("Real 12 / 5 = ", realResult)\n    Write("12 DIV 5 = ", a DIV b)\n    Write("12 % 5 = ", a % b)\n    Write("ABS(-8) = ", ABS(-8))\n    Write("SQRT(16) = ", SQRT(16))\n    Write("POWER(2, 3) = ", POWER(2, 3))\n    Write("SQR(6) = ", SQR(6))\n    Write("MIN = ", MIN(a, b), " MAX = ", MAX(a, b))\nEnd` },
  { id: 'age', title: 'Age check', description: 'Read input and branch', code: `Algorithm AgeCheck\nVariables\n    age : Integer\nBegin\n    Write("Enter your age:")\n    Read(age)\n    If age >= 18 Then\n        Write("You are an adult.")\n    Else\n        Write("You are a minor.")\n    EndIf\nEnd` },
  { id: 'ifelse', title: 'If / Else', description: 'Compare two values', code: `Algorithm Compare\nVariables\n    a, b : Integer\nBegin\n    a <- 12\n    b <- 7\n    If a > b Then\n        Write("a is larger")\n    Else\n        Write("b is larger")\n    EndIf\nEnd` },
  { id: 'for', title: 'For loop', description: 'Count with Step', code: `Algorithm Display\nVariables\n    i : Integer\nBegin\n    For i <- 1 To 10 Do\n        Write("bac 2027")\n    EndFor\nEnd` },
  { id: 'while', title: 'While loop', description: 'Repeat while true', code: `Algorithm Countdown\nVariables\n    i : Integer\nBegin\n    i <- 5\n    While i > 0 Do\n        Write(i)\n        i <- i - 1\n    EndWhile\nEnd` },
  { id: 'array', title: 'Array', description: 'One-based indexing', code: `Algorithm ArrayTest\nVariables\n    numbers : Integer[5]\n    i : Integer\nBegin\n    For i <- 1 To 5 Do\n        numbers[i] <- i * 10\n    EndFor\n    For i <- 1 To 5 Do\n        Write(numbers[i])\n    EndFor\nEnd` },
  { id: 'matrix', title: 'Matrix', description: 'Nested one-based indexes', code: `Algorithm MatrixTest\nVariables\n    matrix : Integer[3][3]\n    i, j : Integer\nBegin\n    For i <- 1 To 3 Do\n        For j <- 1 To 3 Do\n            matrix[i][j] <- i * j\n        EndFor\n    EndFor\n    Write("Matrix:")\n    For i <- 1 To 3 Do\n        For j <- 1 To 3 Do\n            Write(matrix[i][j], " ")\n        EndFor\n    EndFor\nEnd` },
  { id: 'function', title: 'Function', description: 'Parameters and Return', code: `Algorithm FunctionTest\nFunction Power(N : Integer) : Integer\nBegin\n    Return N ^ 2\nEndFunction\nVariables\n    X : Integer\nBegin\n    Write("Enter a number:")\n    Read(X)\n    Write("The power is: ", Power(X))\nEnd` },
  { id: 'procedure', title: 'Procedure', description: 'Reusable actions', code: `Algorithm ProcedureTest\nProcedure SayHello()\nBegin\n    Write("Hello from a procedure.")\nEndProcedure\nBegin\n    SayHello()\nEnd` },
  { id: 'factorial', title: 'Factorial', description: 'Recursion and conditions', code: `Algorithm FactorialTest\nFunction Factorial(n : Integer) : Integer\nBegin\n    If n <= 1 Then\n        Return 1\n    Else\n        Return n * Factorial(n - 1)\n    EndIf\nEndFunction\nVariables\n    result : Integer\nBegin\n    result <- Factorial(5)\n    Write("5! = ", result)\nEnd` },
  { id: 'search', title: 'Search', description: 'Find a value in an array', code: `Algorithm Search\nVariables\n    values : Integer[5]\n    i, found : Integer\nBegin\n    values[1] <- 4\n    values[2] <- 8\n    values[3] <- 15\n    values[4] <- 16\n    values[5] <- 23\n    found <- 0\n    For i <- 1 To 5 Do\n        If values[i] = 15 Then\n            found <- i\n        EndIf\n    EndFor\n    Write("Found at position ", found)\nEnd` },
  { id: 'maxmin', title: 'Maximum / Minimum', description: 'Compare values', code: `Algorithm MaxMin\nVariables\n    a, b, maximum, minimum : Integer\nBegin\n    a <- 18\n    b <- 11\n    maximum <- Max(a, b)\n    minimum <- Min(a, b)\n    Write("Maximum = ", maximum)\n    Write("Minimum = ", minimum)\nEnd` },
  { id: 'average', title: 'Average', description: 'A function over an array', code: `Algorithm Average\nFunction AverageOf(values : Real[3]) : Real\nVariables\n    sum : Real\n    i : Integer\nBegin\n    sum <- 0\n    For i <- 1 To 3 Do\n        sum <- sum + values[i]\n    EndFor\n    Return sum / 3\nEndFunction\nVariables\n    values : Real[3]\nBegin\n    values[1] <- 12.5\n    values[2] <- 15\n    values[3] <- 17.5\n    Write("Average = ", AverageOf(values))\nEnd` },
  { id: 'sorting', title: 'Sorting', description: 'Nested loops and swaps', code: `Algorithm Sorting\nVariables\n    values : Integer[4]\n    i, j, temp : Integer\nBegin\n    values[1] <- 4\n    values[2] <- 1\n    values[3] <- 3\n    values[4] <- 2\n    For i <- 1 To 3 Do\n        For j <- i + 1 To 4 Do\n            If values[j] < values[i] Then\n                temp <- values[i]\n                values[i] <- values[j]\n                values[j] <- temp\n            EndIf\n        EndFor\n    EndFor\n    For i <- 1 To 4 Do\n        Write(values[i], " ")\n    EndFor\nEnd` },
];

function highlightCode(source: string) {
  const escaped = source
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
  return escaped.replace(
    /(\/\/.*$|&quot;.*?&quot;|&#39;.*?&#39;|\b(?:Algorithm|Variables|Constants|Begin|End|Function|EndFunction|Procedure|EndProcedure|If|Then|Else|EndIf|For|To|Step|Do|EndFor|While|EndWhile|Repeat|Until|Read|Write|Return|True|False|AND|OR|NOT|DIV|Integer|Real|String|Boolean|Character)\b|\b\d+(?:\.\d+)?\b|&lt;-|&lt;=|&gt;=|&lt;&gt;|==|!=|[+\-*/%^=<>])/gim,
    (token) => {
      if (token.startsWith('//')) return `<span class="syntax-comment">${token}</span>`;
      if (token.startsWith('&quot;') || token.startsWith('&#39;')) return `<span class="syntax-string">${token}</span>`;
      if (/^\d/.test(token)) return `<span class="syntax-number">${token}</span>`;
      if (/^[+\-*/%^=<>!]|^&lt;|^&gt;/.test(token)) return `<span class="syntax-operator">${token}</span>`;
      return `<span class="syntax-keyword">${token}</span>`;
    },
  );
}

function Home() {
  const [code, setCode] = useState(starterCode);
  const [status, setStatus] = useState<RunStatus>('idle');
  const [output, setOutput] = useState<OutputLine[]>([]);
  const [pendingPrompt, setPendingPrompt] = useState<PendingPrompt | null>(null);
  const [inputValue, setInputValue] = useState('');
  const [errorLine, setErrorLine] = useState<number | null>(null);
  const [errorMessage, setErrorMessage] = useState('');
  const [saveState, setSaveState] = useState('Saved locally');
  const [lastRunDuration, setLastRunDuration] = useState('—');
  const runnerRef = useRef<AlgoRunner | null>(null);
  const inputResolverRef = useRef<((value: string) => void) | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const highlightRef = useRef<HTMLPreElement | null>(null);

  const runAlgorithm = async () => {
    runnerRef.current?.stop();
    setErrorLine(null);
    setErrorMessage('');
    setInputValue('');
    setStatus('running');
    setSaveState('Saved locally');
    setOutput([{ kind: 'system', text: 'Run started · reading your algorithm' }]);
    const started = performance.now();
    try {
      const program = parseProgram(code);
      const runner = new AlgoRunner(program, {
        onOutput: (text) => setOutput((current) => [...current, { kind: 'value', text }]),
        onPrompt: (request: InputRequest) => {
          setPendingPrompt({
            variable: request.variable,
            type: request.type,
            message: `Enter a ${request.type.toLowerCase()} for ${request.variable}`,
          });
          setStatus('waiting');
          setOutput((current) => [...current, { kind: 'prompt', text: `Input needed for ${request.variable}` }]);
          return new Promise<string>((resolve) => {
            inputResolverRef.current = resolve;
          });
        },
      });
      runnerRef.current = runner;
      await runner.run();
      setPendingPrompt(null);
      setStatus('success');
      setLastRunDuration(`${Math.max(1, Math.round(performance.now() - started))} ms`);
      setOutput((current) => [...current, { kind: 'system', text: 'Run completed successfully.' }]);
    } catch (error) {
      setPendingPrompt(null);
      if (error instanceof AlgoError) {
        setErrorLine(error.line);
        setErrorMessage(error.message);
        setOutput((current) => [...current, { kind: 'error', text: `Line ${error.line}: ${error.message}` }]);
        setStatus('error');
      } else if (error instanceof Error && error.message === 'STOPPED') {
        setStatus('stopped');
        setOutput((current) => [...current, { kind: 'system', text: 'Run stopped by the user.' }]);
      } else {
        setErrorLine(null);
        setErrorMessage('The runner stopped unexpectedly.');
        setOutput((current) => [...current, { kind: 'error', text: 'The runner stopped unexpectedly.' }]);
        setStatus('error');
      }
    } finally {
      runnerRef.current = null;
      inputResolverRef.current = null;
    }
  };

  const submitInput = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!pendingPrompt || !inputValue.trim() || !inputResolverRef.current) return;
    const trimmedValue = inputValue.trim();
    setOutput((current) => [...current, { kind: 'value', text: `> ${trimmedValue}` }]);
    setInputValue('');
    setStatus('running');
    inputResolverRef.current(trimmedValue);
    inputResolverRef.current = null;
  };

  const resetWorkspace = () => {
    runnerRef.current?.stop();
    inputResolverRef.current?.('');
    setCode(starterCode);
    setOutput([]);
    setPendingPrompt(null);
    setErrorLine(null);
    setErrorMessage('');
    setStatus('idle');
    setSaveState('Saved locally');
    setLastRunDuration('—');
  };

  const loadExample = (example: Example) => {
    runnerRef.current?.stop();
    inputResolverRef.current?.('');
    setCode(example.code);
    setOutput([]);
    setPendingPrompt(null);
    setErrorLine(null);
    setErrorMessage('');
    setStatus('idle');
    setSaveState(`Loaded ${example.title}`);
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
        event.preventDefault();
        void runAlgorithm();
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        downloadCode();
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'o') {
        event.preventDefault();
        fileInputRef.current?.click();
      }
      if (event.key === 'F5' && event.shiftKey) {
        event.preventDefault();
        stopAlgorithm();
      } else if (event.key === 'F5') {
        event.preventDefault();
        void runAlgorithm();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  });

  const stopAlgorithm = () => {
    runnerRef.current?.stop();
    inputResolverRef.current?.('');
    inputResolverRef.current = null;
    setPendingPrompt(null);
    setStatus('stopped');
  };

  const downloadCode = () => {
    const name = (code.match(/^Algorithm\s+([A-Za-z_]\w*)/im)?.[1] ?? 'algorithm').toLowerCase();
    const blob = new Blob([code], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${name}.algo`;
    anchor.click();
    URL.revokeObjectURL(url);
    setSaveState(`Saved ${name}.algo`);
  };

  const openCode = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    void file.text().then((text) => {
      setCode(text);
      setOutput([]);
      setStatus('idle');
      setSaveState(`Opened ${file.name}`);
    });
    event.target.value = '';
  };

  const clearOutput = () => {
    setOutput([]);
    setErrorLine(null);
    setErrorMessage('');
    if (status === 'error') setStatus('idle');
  };

  const lineCount = Math.max(code.split('\n').length, 1);
  const statusLabel =
    status === 'waiting'
      ? 'Waiting for input'
      : status === 'success'
        ? 'Run complete'
        : status === 'error'
          ? 'Needs attention'
        : status === 'stopped'
          ? 'Stopped'
          : status === 'running'
            ? 'Running'
            : 'Ready to run';

  return (
    <div className="app-shell app-noise dark">
      <header className="topbar" data-testid="header-app">
        <div className="brand-lockup">
          <div className="brand-mark-wrap">
            <div className="brand-mark" aria-hidden="true"><Code2 size={16} strokeWidth={2.4} /></div>
            <span className="brand-name" data-testid="text-brand">English Algo Runner</span>
          </div>
          <span className="brand-subtitle">offline algorithm lab</span>
        </div>
        <div className="topbar-actions">
          <input ref={fileInputRef} type="file" accept=".algo,.txt" hidden onChange={openCode} />
          <button className="quiet-button" type="button" onClick={() => fileInputRef.current?.click()} data-testid="button-open-file">
            <FileCode2 size={15} /> Open
          </button>
          <button className="quiet-button" type="button" onClick={downloadCode} data-testid="button-save-file">
            <Save size={15} /> Save
          </button>
          <button
            className="quiet-button"
            type="button"
            data-testid="button-help"
            onClick={() => {
              setOutput([
                 { kind: 'system', text: 'Tip · Read(variable) pauses the run until you answer.' },
                 { kind: 'system', text: 'Try changing one line, then press Run again.' },
              ]);
              setStatus('idle');
            }}
          >
            <CircleHelp size={15} /> How it works
          </button>
          <button
            className="quiet-button"
            type="button"
            data-testid="button-settings"
            onClick={() => setSaveState('Preferences are local to this workspace')}
          >
            <Settings2 size={15} /> Preferences
          </button>
        </div>
      </header>

      <div className="workspace">
        <aside className="sidebar" aria-label="Workspace navigation">
          <div>
            <p className="sidebar-kicker">Workspace</p>
            <button className="sidebar-link active" type="button" data-testid="button-nav-runner" onClick={() => setStatus('idle')}>
              <Terminal size={15} /> Runner
            </button>
            <button className="sidebar-link" type="button" data-testid="button-nav-examples" onClick={() => loadExample(examples[1])}>
              <BookOpen size={15} /> Examples
            </button>
            <button className="sidebar-link" type="button" data-testid="button-nav-reset" onClick={resetWorkspace}>
              <ListRestart size={15} /> Reset workspace
            </button>
          </div>
          <div className="sidebar-note">
            <strong><Lightbulb size={13} style={{ verticalAlign: '-2px', marginRight: 5 }} /> Practice note</strong>
            Readable steps are real logic. Start small, run often, then change one line at a time.
          </div>
        </aside>

        <main className="main-content">
          <div className="main-inner">
            <section className="workspace-intro">
              <div>
                <div className="eyebrow"><span className="pulse-dot" /> Your practice desk</div>
                <h1 className="workspace-title">Make an idea run.</h1>
                <p className="workspace-description">
                  Write an algorithm in plain English, run it, and watch each answer land in the terminal.
                  No setup. No distractions.
                </p>
              </div>
              <div className="run-controls">
                <button
                  className={`run-button${status === 'running' ? ' running' : ''}`}
                  type="button"
                  onClick={() => void runAlgorithm()}
                  data-testid="button-run-algorithm"
                >
                  {status === 'running' ? <Clock3 size={16} /> : <Play size={16} fill="currentColor" />}
                  {status === 'running' ? 'Running…' : 'Run algorithm'}
                  <span className="shortcut">⌘ ↵</span>
                </button>
                <button className="quiet-button" type="button" onClick={stopAlgorithm} data-testid="button-stop-algorithm" disabled={status !== 'running' && status !== 'waiting'}>
                  <TriangleAlert size={15} /> Stop
                </button>
                <button className="quiet-button" type="button" onClick={resetWorkspace} data-testid="button-reset-workspace">
                  <RotateCcw size={15} /> Reset
                </button>
              </div>
            </section>

            <section className="studio-grid" aria-label="Algorithm studio">
              <div className="panel editor-panel">
                <div className="panel-heading editor-heading">
                  <div className="panel-heading-left">
                    <FileCode2 size={16} color="hsl(var(--primary))" />
                    <h2>Untitled algorithm</h2>
                    <span className="panel-label">.algo</span>
                  </div>
                  <div className="editor-toolbar">
                    <button className="tool-button" type="button" title="Save .algo file" onClick={downloadCode} data-testid="button-save-status">
                      <Save size={14} />
                    </button>
                    <button className="tool-button" type="button" title="Clear editor" onClick={() => { setCode(''); setSaveState('Unsaved edits'); }} data-testid="button-clear-editor">
                      <WandSparkles size={14} />
                    </button>
                  </div>
                </div>
                <div className="editor-body">
                  <div className="line-numbers" aria-hidden="true">
                    {Array.from({ length: lineCount }, (_, index) => (
                      <div className={`line-number${errorLine === index + 1 ? ' error-line' : ''}`} key={index}>
                        {index + 1}
                      </div>
                    ))}
                  </div>
                  <div className="editor-surface">
                    <pre
                      ref={highlightRef}
                      className="code-highlight"
                      aria-hidden="true"
                      dangerouslySetInnerHTML={{ __html: `${highlightCode(code)}\n` }}
                    />
                    <textarea
                      className="code-editor"
                      value={code}
                      spellCheck={false}
                      aria-label="English algorithm editor"
                      data-testid="input-algorithm-editor"
                      onScroll={(event) => {
                        if (highlightRef.current) {
                          highlightRef.current.scrollTop = event.currentTarget.scrollTop;
                          highlightRef.current.scrollLeft = event.currentTarget.scrollLeft;
                        }
                      }}
                      onKeyDown={(event) => {
                        if (event.key === 'Tab') {
                          event.preventDefault();
                          const target = event.currentTarget;
                          const start = target.selectionStart;
                          const end = target.selectionEnd;
                          setCode(`${code.slice(0, start)}  ${code.slice(end)}`);
                          requestAnimationFrame(() => {
                            target.selectionStart = start + 2;
                            target.selectionEnd = start + 2;
                          });
                        }
                      }}
                      onChange={(event) => {
                        setCode(event.target.value);
                        setSaveState('Unsaved edits');
                        if (status === 'error') {
                          setErrorLine(null);
                          setErrorMessage('');
                          setStatus('idle');
                        }
                      }}
                    />
                  </div>
                </div>
                <div className="editor-footer">
                  <span className="save-state" data-testid="status-save">{saveState}</span>
                  <span>{lineCount} lines · English pseudocode</span>
                </div>
              </div>

              <div className="side-stack">
                <div className="panel output-panel">
                  <div className="panel-heading">
                    <div className="panel-heading-left">
                      <Terminal size={16} color="hsl(var(--primary))" />
                      <h2>Output</h2>
                    </div>
                    <div className="panel-heading-left">
                      <button className="tool-button" type="button" title="Clear output" onClick={clearOutput} data-testid="button-clear-output">
                        <RotateCcw size={13} />
                      </button>
                      <span className="panel-label">terminal</span>
                    </div>
                  </div>
                  <div className="terminal" data-testid="output-terminal" aria-live="polite">
                    {output.length === 0 ? (
                      <div className="terminal-empty">
                        <div className="terminal-line terminal-muted"><span className="terminal-prompt">›</span> Your output will appear here.</div>
                        <div className="terminal-line terminal-muted"><span className="terminal-prompt">›</span> Press Run when you are ready.</div>
                      </div>
                    ) : (
                      output.map((line, index) => (
                        <div className={`terminal-line terminal-${line.kind}`} key={`${line.text}-${index}`}>
                          <span className="terminal-prompt">{line.kind === 'error' ? '!' : line.kind === 'prompt' ? '?' : '›'}</span>
                          <span>{line.text}</span>
                        </div>
                      ))
                    )}
                  </div>
                </div>

                {pendingPrompt && (
                  <div className="panel input-panel" data-testid="panel-input-prompt">
                    <div className="panel-heading">
                      <div className="panel-heading-left">
                        <ArrowRight size={16} color="hsl(var(--secondary-foreground))" />
                        <h2>Input needed</h2>
                      </div>
                      <span className="panel-label">Read()</span>
                    </div>
                    <form className="input-form" onSubmit={submitInput}>
                      <p className="prompt-copy">{pendingPrompt.message}</p>
                      <div className="input-row">
                        <input
                          className="input-field"
                          value={inputValue}
                          autoFocus
                          placeholder="Type an answer"
                          aria-label="Algorithm input"
                          data-testid="input-algorithm-answer"
                          onChange={(event) => setInputValue(event.target.value)}
                        />
                        <button className="submit-input" type="submit" aria-label="Submit answer" data-testid="button-submit-answer">
                          <Send size={16} />
                        </button>
                      </div>
                      <p className="input-hint">Your answer stays in this run only.</p>
                    </form>
                  </div>
                )}

                <div className="panel examples-panel">
                  <div className="panel-heading">
                    <div className="panel-heading-left">
                      <BookOpen size={15} color="hsl(var(--primary))" />
                      <h2>Try an example</h2>
                    </div>
                    <span className="panel-label">starter shelf</span>
                  </div>
                  <div className="examples-list">
                    {examples.map((example) => (
                      <button
                        className="example-button"
                        type="button"
                        key={example.id}
                        onClick={() => loadExample(example)}
                        data-testid={`button-example-${example.id}`}
                      >
                        <span className="example-title">
                          <span className="example-icon"><ChevronRight size={14} /></span>
                          <span>
                            {example.title}
                            <small style={{ display: 'block', marginTop: 2, color: 'hsl(var(--muted-foreground))', fontWeight: 400 }}>{example.description}</small>
                          </span>
                        </span>
                        <span className="example-meta">{example.lines ?? `${example.code.split('\n').length} lines`}</span>
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </section>

            {status === 'error' && (
              <div className="error-banner" data-testid="status-error">
                <TriangleAlert size={17} />
                <div>
                  <strong>There is a line to revisit</strong>
                  <p>Line {errorLine}: {errorMessage}</p>
                </div>
              </div>
            )}

            <footer className="statusbar">
              <div className="status-cluster">
                <span className="status-item status-ready" data-testid="status-runner">
                  {status === 'success' ? <Check size={13} /> : <span className="pulse-dot" />}
                  {statusLabel}
                </span>
                <span className="status-item"><Clock3 size={13} /> Last run {lastRunDuration}</span>
                <span className="status-item"><Save size={13} /> Local only</span>
              </div>
              <span data-testid="text-version">English Algo Runner · v0.4</span>
            </footer>
          </div>
        </main>
      </div>
    </div>
  );
}

function Router() {
  return (
    <RoutedErrorBoundary>
      <Switch>
        <Route path="/" component={Home} />
        <Route component={NotFound} />
      </Switch>
    </RoutedErrorBoundary>
  );
}

function RoutedErrorBoundary({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}>{children}</ErrorBoundary>;
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}>
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
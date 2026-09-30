export type BaseType = 'Integer' | 'Real' | 'String' | 'Boolean' | 'Character';

export type TypeSpec = {
  base: BaseType;
  dimensions: number[];
};

type Token = {
  kind: 'number' | 'string' | 'char' | 'identifier' | 'operator' | 'punctuation';
  value: string;
  line: number;
};

type Expr =
  | { kind: 'literal'; value: string | number | boolean; integer?: boolean; line: number }
  | { kind: 'identifier'; name: string; line: number }
  | { kind: 'unary'; operator: string; operand: Expr; line: number }
  | { kind: 'binary'; operator: string; left: Expr; right: Expr; line: number }
  | { kind: 'call'; name: string; args: Expr[]; line: number }
  | { kind: 'index'; target: Expr; indexes: Expr[]; line: number };

type LValue = {
  target: Expr;
  line: number;
};

type Declaration = {
  names: string[];
  type: TypeSpec;
  line: number;
  constant?: boolean;
  initializers?: Expr[];
};

type Statement =
  | { kind: 'assign'; target: LValue; value: Expr; line: number }
  | { kind: 'read'; target: LValue; line: number }
  | { kind: 'write'; expressions: Expr[]; line: number }
  | { kind: 'if'; condition: Expr; thenBody: Statement[]; elseBody: Statement[]; line: number }
  | { kind: 'for'; target: LValue; start: Expr; end: Expr; step: Expr; body: Statement[]; line: number }
  | { kind: 'while'; condition: Expr; body: Statement[]; line: number }
  | { kind: 'repeat'; body: Statement[]; condition: Expr; line: number }
  | { kind: 'return'; value: Expr | null; line: number }
  | { kind: 'expression'; expression: Expr; line: number };

type Routine = {
  name: string;
  kind: 'Function' | 'Procedure';
  parameters: { name: string; type: TypeSpec }[];
  returnType: TypeSpec | null;
  declarations: Declaration[];
  body: Statement[];
  line: number;
};

export type Program = {
  name: string;
  declarations: Declaration[];
  body: Statement[];
  routines: Map<string, Routine>;
};

export type InputRequest = {
  variable: string;
  type: BaseType;
  line: number;
};

export class AlgoError extends Error {
  constructor(
    public readonly message: string,
    public readonly line: number,
    public readonly stage: 'Syntax Error' | 'Runtime Error' | 'Semantic Error' = 'Syntax Error',
  ) {
    super(message);
    this.name = 'AlgoError';
  }
}

class ReturnSignal {
  constructor(public readonly value: unknown) {}
}

class StopSignal extends Error {
  constructor() {
    super('STOPPED');
    this.name = 'StopSignal';
  }
}

function upper(value: string) {
  return value.toUpperCase();
}

function stripComment(line: string) {
  let quote: string | null = null;
  for (let index = 0; index < line.length - 1; index += 1) {
    const char = line[index];
    if ((char === '"' || char === "'") && line[index - 1] !== '\\') {
      quote = quote === char ? null : quote ?? char;
    }
    if (!quote && char === '/' && line[index + 1] === '/') return line.slice(0, index);
  }
  return line;
}

function tokenize(source: string, line: number): Token[] {
  const tokens: Token[] = [];
  let index = 0;
  while (index < source.length) {
    const char = source[index];
    if (/\s/.test(char)) {
      index += 1;
      continue;
    }
    if (char === '"' || char === "'") {
      const quote = char;
      const start = index;
      index += 1;
      let value = '';
      while (index < source.length && source[index] !== quote) {
        if (source[index] === '\\' && index + 1 < source.length) {
          const escaped = source[index + 1];
          value += escaped === 'n' ? '\n' : escaped === 't' ? '\t' : escaped;
          index += 2;
        } else {
          value += source[index];
          index += 1;
        }
      }
      if (index >= source.length) throw new AlgoError('Unterminated string or character literal.', line);
      index += 1;
      tokens.push({ kind: quote === '"' ? 'string' : 'char', value, line });
      if (index === start) index += 1;
      continue;
    }
    const two = source.slice(index, index + 2);
    if (['<-', '<=', '>=', '<>', '==', '!='].includes(two)) {
      tokens.push({ kind: 'operator', value: two, line });
      index += 2;
      continue;
    }
    if ('+-*/%^=<>'.includes(char)) {
      tokens.push({ kind: 'operator', value: char, line });
      index += 1;
      continue;
    }
    if ('()[],'.includes(char)) {
      tokens.push({ kind: 'punctuation', value: char, line });
      index += 1;
      continue;
    }
    if (/\d/.test(char) || (char === '.' && /\d/.test(source[index + 1] ?? ''))) {
      const start = index;
      index += 1;
      while (index < source.length && /[\d.]/.test(source[index])) index += 1;
      tokens.push({ kind: 'number', value: source.slice(start, index), line });
      continue;
    }
    if (/[A-Za-z_]/.test(char)) {
      const start = index;
      index += 1;
      while (index < source.length && /[A-Za-z0-9_]/.test(source[index])) index += 1;
      tokens.push({ kind: 'identifier', value: source.slice(start, index), line });
      continue;
    }
    throw new AlgoError(`Unexpected character '${char}'.`, line);
  }
  return tokens;
}

class ExpressionParser {
  private index = 0;

  constructor(private readonly tokens: Token[], private readonly line: number) {}

  parse() {
    const expression = this.parseBinary(0);
    if (this.index < this.tokens.length) {
      throw new AlgoError(`Unexpected token '${this.tokens[this.index].value}'.`, this.line);
    }
    return expression;
  }

  parseList() {
    const expressions: Expr[] = [];
    if (!this.peek()) return expressions;
    while (this.peek()) {
      expressions.push(this.parseBinary(0));
      if (this.peek()?.value !== ',') break;
      this.index += 1;
    }
    if (this.peek()) throw new AlgoError(`Unexpected token '${this.peek()?.value}'.`, this.line);
    return expressions;
  }

  private peek() {
    return this.tokens[this.index];
  }

  private parseBinary(minPrecedence: number): Expr {
    let left = this.parsePrefix();
    const precedence: Record<string, number> = {
      OR: 1,
      AND: 2,
      '=': 3,
      '==': 3,
      '<>': 3,
      '!=': 3,
      '<': 3,
      '>': 3,
      '<=': 3,
      '>=': 3,
      '+': 4,
      '-': 4,
      '*': 5,
      '/': 5,
      DIV: 5,
      '%': 5,
      '^': 6,
    };
    while (this.peek()) {
      const rawOperator = this.peek().value;
      const operator = /^[A-Za-z]+$/.test(rawOperator) ? upper(rawOperator) : rawOperator;
      const currentPrecedence = precedence[operator];
      if (currentPrecedence === undefined || currentPrecedence < minPrecedence) break;
      this.index += 1;
      const right = this.parseBinary(currentPrecedence + (operator === '^' ? 0 : 1));
      left = { kind: 'binary', operator, left, right, line: this.line };
    }
    return left;
  }

  private parsePrefix(): Expr {
    const token = this.peek();
    if (!token) throw new AlgoError('Expected an expression.', this.line);
    if (token.kind === 'operator' && ['+', '-'].includes(token.value)) {
      this.index += 1;
      return { kind: 'unary', operator: token.value, operand: this.parsePrefix(), line: this.line };
    }
    if (token.kind === 'identifier' && upper(token.value) === 'NOT') {
      this.index += 1;
      return { kind: 'unary', operator: 'NOT', operand: this.parsePrefix(), line: this.line };
    }
    if (token.kind === 'number') {
      this.index += 1;
      return { kind: 'literal', value: Number(token.value), integer: !token.value.includes('.'), line: this.line };
    }
    if (token.kind === 'string' || token.kind === 'char') {
      this.index += 1;
      return { kind: 'literal', value: token.value, line: this.line };
    }
    if (token.value === '(') {
      this.index += 1;
      const expression = this.parseBinary(0);
      if (this.peek()?.value !== ')') throw new AlgoError("Expected ')'.", this.line);
      this.index += 1;
      return this.parseSuffix(expression);
    }
    if (token.kind === 'identifier') {
      this.index += 1;
      const name = token.value;
      const keyword = upper(name);
      let expression: Expr =
        keyword === 'TRUE'
          ? { kind: 'literal', value: true, line: this.line }
          : keyword === 'FALSE'
            ? { kind: 'literal', value: false, line: this.line }
            : { kind: 'identifier', name, line: this.line };
      if (this.peek()?.value === '(') {
        this.index += 1;
        const args: Expr[] = [];
        if (this.peek()?.value !== ')') {
          while (this.peek()) {
            args.push(this.parseBinary(0));
            if (this.peek()?.value !== ',') break;
            this.index += 1;
          }
        }
        if (this.peek()?.value !== ')') throw new AlgoError("Expected ')'.", this.line);
        this.index += 1;
        expression = { kind: 'call', name, args, line: this.line };
      }
      return this.parseSuffix(expression);
    }
    throw new AlgoError(`Unexpected token '${token.value}'.`, this.line);
  }

  private parseSuffix(expression: Expr) {
    while (this.peek()?.value === '[') {
      this.index += 1;
      const indexes: Expr[] = [];
      while (this.peek() && this.peek().value !== ']') {
        indexes.push(this.parseBinary(0));
        if (this.peek()?.value !== ',') break;
        this.index += 1;
      }
      if (this.peek()?.value !== ']') throw new AlgoError("Expected ']'.", this.line);
      this.index += 1;
      expression = { kind: 'index', target: expression, indexes, line: this.line };
    }
    return expression;
  }
}

function parseExpression(source: string, line: number) {
  return new ExpressionParser(tokenize(source, line), line).parse();
}

function parseExpressionList(source: string, line: number) {
  return new ExpressionParser(tokenize(source, line), line).parseList();
}

function splitTopLevel(source: string) {
  const parts: string[] = [];
  let start = 0;
  let depth = 0;
  let quote: string | null = null;
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if ((char === '"' || char === "'") && source[index - 1] !== '\\') quote = quote === char ? null : quote ?? char;
    if (quote) continue;
    if ('(['.includes(char)) depth += 1;
    if (') ]'.replace(' ', '').includes(char)) depth -= 1;
    if (char === ',' && depth === 0) {
      parts.push(source.slice(start, index).trim());
      start = index + 1;
    }
  }
  parts.push(source.slice(start).trim());
  return parts.filter(Boolean);
}

function parseType(source: string, line: number): TypeSpec {
  const match = source.trim().match(/^(Integer|Real|String|Boolean|Character)((?:\s*\[\s*\d+\s*\])*)$/i);
  if (!match) throw new AlgoError(`Unknown type declaration '${source.trim()}'.`, line);
  const dimensions = [...match[2].matchAll(/\[\s*(\d+)\s*\]/g)].map((value) => Number(value[1]));
  return { base: (match[1][0].toUpperCase() + match[1].slice(1).toLowerCase()) as BaseType, dimensions };
}

function parseParameter(source: string, line: number) {
  const match = source.trim().match(/^([A-Za-z_]\w*)\s*:\s*(.+)$/);
  if (!match) throw new AlgoError(`Expected parameter declaration 'name : Type'.`, line);
  return { name: match[1], type: parseType(match[2], line) };
}

class Parser {
  private index = 0;
  private readonly lines: string[];
  private readonly routines = new Map<string, Routine>();

  constructor(source: string) {
    this.lines = source.split(/\r?\n/).map((line) => stripComment(line).trim());
  }

  parse(): Program {
    while (this.index < this.lines.length && !this.lines[this.index]) this.index += 1;
    const header = this.current();
    const algorithm = header.match(/^Algorithm\s+([A-Za-z_]\w*)$/i);
    if (!algorithm) throw new AlgoError('The program must start with Algorithm ProgramName.', this.line());
    this.index += 1;
    const declarations: Program['declarations'] = [];
    let mainBody: Statement[] | null = null;
    while (this.index < this.lines.length) {
      this.skipBlank();
      if (this.index >= this.lines.length) break;
      const line = this.current();
      if (/^Function\b/i.test(line) || /^Procedure\b/i.test(line)) {
        const routine = this.parseRoutine();
        const key = routine.name.toLowerCase();
        if (this.routines.has(key)) throw new AlgoError(`Routine '${routine.name}' is already declared.`, routine.line, 'Semantic Error');
        this.routines.set(key, routine);
      } else if (/^Variables$/i.test(line)) {
        this.index += 1;
        declarations.push(...this.parseDeclarations());
      } else if (/^Constants$/i.test(line)) {
        this.index += 1;
        declarations.push(...this.parseDeclarations(true));
      } else if (/^Begin$/i.test(line)) {
        this.index += 1;
        mainBody = this.parseStatements(['End']);
        this.expect('End', 'Missing End.');
      } else {
        throw new AlgoError(`Unexpected line '${line}'.`, this.line());
      }
    }
    if (!mainBody) throw new AlgoError('The program is missing a main Begin / End block.', this.line());
    return { name: algorithm[1], declarations, body: mainBody, routines: this.routines };
  }

  private parseRoutine(): Routine {
    const lineNumber = this.line();
    const line = this.current();
    const match = line.match(/^(Function|Procedure)\s+([A-Za-z_]\w*)\s*\((.*)\)\s*(?::\s*(.+))?$/i);
    if (!match) throw new AlgoError('Invalid Function or Procedure declaration.', lineNumber);
    const kind = (match[1][0].toUpperCase() + match[1].slice(1).toLowerCase()) as Routine['kind'];
    const parameters = match[3].trim() ? splitTopLevel(match[3]).map((part) => parseParameter(part, lineNumber)) : [];
    const returnType = kind === 'Function' ? (match[4] ? parseType(match[4], lineNumber) : null) : null;
    this.index += 1;
    const declarations: Routine['declarations'] = [];
    while (this.index < this.lines.length && !/^Begin$/i.test(this.current())) {
      this.skipBlank();
      if (this.index >= this.lines.length || /^Begin$/i.test(this.current())) break;
      if (/^Variables$/i.test(this.current())) {
        this.index += 1;
        declarations.push(...this.parseDeclarations());
      } else if (/^Constants$/i.test(this.current())) {
        this.index += 1;
        declarations.push(...this.parseDeclarations(true));
      } else {
        throw new AlgoError(`Expected Variables, Constants, or Begin inside ${kind}.`, this.line());
      }
    }
    this.expect('Begin', `Missing Begin for ${kind} '${match[2]}'.`);
    const body = this.parseStatements([kind === 'Function' ? 'EndFunction' : 'EndProcedure']);
    this.expect(kind === 'Function' ? 'EndFunction' : 'EndProcedure', `Missing ${kind === 'Function' ? 'EndFunction' : 'EndProcedure'}.`);
    return { name: match[2], kind, parameters, returnType, declarations, body, line: lineNumber };
  }

  private parseDeclarations(constant = false) {
    const declarations: Declaration[] = [];
    while (this.index < this.lines.length) {
      this.skipBlank();
      if (this.index >= this.lines.length || /^(Begin|Variables|Constants|Function|Procedure)\b/i.test(this.current())) break;
      const lineNumber = this.line();
      if (constant) {
        const constantMatch = this.current().match(/^([A-Za-z_]\w*)\s*:\s*(.+?)\s*(?:<-|=)\s*(.+)$/);
        if (!constantMatch) {
          throw new AlgoError("Expected a constant like 'MaxAttempts : Integer <- 3'.", lineNumber);
        }
        declarations.push({
          names: [constantMatch[1]],
          type: parseType(constantMatch[2], lineNumber),
          line: lineNumber,
          constant: true,
          initializers: [parseExpression(constantMatch[3], lineNumber)],
        });
        this.index += 1;
        continue;
      }
      const match = this.current().match(/^(.+?)\s*:\s*(.+)$/);
      if (!match) throw new AlgoError("Expected a declaration like 'value : Integer'.", lineNumber);
      const names = match[1].split(',').map((name) => name.trim()).filter(Boolean);
      if (names.some((name) => !/^[A-Za-z_]\w*$/.test(name))) throw new AlgoError('Invalid variable name.', lineNumber);
      declarations.push({ names, type: parseType(match[2], lineNumber), line: lineNumber });
      this.index += 1;
    }
    return declarations;
  }

  private parseStatements(terminators: string[]): Statement[] {
    const statements: Statement[] = [];
    while (this.index < this.lines.length) {
      this.skipBlank();
      if (this.index >= this.lines.length) break;
      const line = this.current();
      const keyword = upper(line.split(/\s+/)[0]);
      if (terminators.some((item) => upper(item) === keyword || upper(item) === upper(line))) break;
      const lineNumber = this.line();
      if (/^If\b/i.test(line)) {
        if (!/\bThen\s*$/i.test(line)) throw new AlgoError('Expected Then after If condition.', lineNumber);
        const conditionText = line.replace(/^If\s+/i, '').replace(/\s+Then\s*$/i, '');
        this.index += 1;
        const thenBody = this.parseStatements(['Else', 'EndIf']);
        const elseBody: Statement[] = [];
        if (/^Else$/i.test(this.current() ?? '')) {
          this.index += 1;
          elseBody.push(...this.parseStatements(['EndIf']));
        }
        this.expect('EndIf', 'Missing EndIf.');
        statements.push({ kind: 'if', condition: parseExpression(conditionText, lineNumber), thenBody, elseBody, line: lineNumber });
        continue;
      }
      if (/^For\b/i.test(line)) {
        if (!/\bDo\s*$/i.test(line)) throw new AlgoError('Expected Do after For statement.', lineNumber);
        const match = line.match(/^For\s+(.+?)\s*<-\s*(.+?)\s+To\s+(.+?)(?:\s+Step\s+(.+?))?\s+Do$/i);
        if (!match) throw new AlgoError('Invalid For statement.', lineNumber);
        this.index += 1;
        const body = this.parseStatements(['EndFor']);
        this.expect('EndFor', 'Missing EndFor.');
        statements.push({
          kind: 'for',
          target: this.parseLValue(match[1], lineNumber),
          start: parseExpression(match[2], lineNumber),
          end: parseExpression(match[3], lineNumber),
          step: parseExpression(match[4] ?? '1', lineNumber),
          body,
          line: lineNumber,
        });
        continue;
      }
      if (/^While\b/i.test(line)) {
        if (!/\bDo\s*$/i.test(line)) throw new AlgoError('Expected Do after While condition.', lineNumber);
        const conditionText = line.replace(/^While\s+/i, '').replace(/\s+Do\s*$/i, '');
        this.index += 1;
        const body = this.parseStatements(['EndWhile']);
        this.expect('EndWhile', 'Missing EndWhile.');
        statements.push({ kind: 'while', condition: parseExpression(conditionText, lineNumber), body, line: lineNumber });
        continue;
      }
      if (/^Repeat$/i.test(line)) {
        this.index += 1;
        const body = this.parseStatements(['Until']);
        if (!/^Until\b/i.test(this.current() ?? '')) throw new AlgoError('Missing Until after Repeat.', lineNumber);
        const conditionText = (this.current() ?? '').replace(/^Until\s+/i, '');
        if (!conditionText) throw new AlgoError('Expected a condition after Until.', this.line());
        const untilLine = this.line();
        this.index += 1;
        statements.push({ kind: 'repeat', body, condition: parseExpression(conditionText, untilLine), line: lineNumber });
        continue;
      }
      if (/^Read\s*\(/i.test(line)) {
        const args = this.parseCallLine(line, 'Read', lineNumber);
        if (args.length !== 1) throw new AlgoError('Read expects exactly one variable.', lineNumber);
        this.index += 1;
        statements.push({ kind: 'read', target: { target: args[0], line: lineNumber }, line: lineNumber });
        continue;
      }
      if (/^Write\s*\(/i.test(line)) {
        const args = this.parseCallLine(line, 'Write', lineNumber);
        this.index += 1;
        statements.push({ kind: 'write', expressions: args, line: lineNumber });
        continue;
      }
      if (/^Return\b/i.test(line)) {
        const source = line.replace(/^Return\b/i, '').trim();
        this.index += 1;
        statements.push({ kind: 'return', value: source ? parseExpression(source, lineNumber) : null, line: lineNumber });
        continue;
      }
      if (/^(End|Else|EndIf|EndFor|EndWhile|Until|EndFunction|EndProcedure)\b/i.test(line)) {
        throw new AlgoError(`Unexpected '${line}'.`, lineNumber);
      }
      const assignmentIndex = line.indexOf('<-');
      if (assignmentIndex >= 0) {
        const left = line.slice(0, assignmentIndex).trim();
        const right = line.slice(assignmentIndex + 2).trim();
        if (!left || !right) throw new AlgoError('Assignments need a target and a value.', lineNumber);
        this.index += 1;
        statements.push({ kind: 'assign', target: this.parseLValue(left, lineNumber), value: parseExpression(right, lineNumber), line: lineNumber });
        continue;
      }
      this.index += 1;
      statements.push({ kind: 'expression', expression: parseExpression(line, lineNumber), line: lineNumber });
    }
    return statements;
  }

  private parseCallLine(line: string, name: string, lineNumber: number) {
    const match = line.match(new RegExp(`^${name}\\s*\\((.*)\\)\\s*$`, 'i'));
    if (!match) throw new AlgoError(`Invalid ${name} statement.`, lineNumber);
    return parseExpressionList(match[1], lineNumber);
  }

  private parseLValue(source: string, lineNumber: number): LValue {
    const target = parseExpression(source.trim(), lineNumber);
    if (target.kind !== 'identifier' && target.kind !== 'index') throw new AlgoError('Assignment target must be a variable or array element.', lineNumber);
    return { target, line: lineNumber };
  }

  private current() {
    return this.lines[this.index] ?? '';
  }

  private line() {
    return this.index + 1;
  }

  private skipBlank() {
    while (this.index < this.lines.length && !this.lines[this.index]) this.index += 1;
  }

  private expect(text: string, message: string) {
    if (!new RegExp(`^${text}$`, 'i').test(this.current())) throw new AlgoError(message, this.line());
    this.index += 1;
  }
}

export function parseProgram(source: string): Program {
  return new Parser(source).parse();
}

type StoredValue = unknown;

class Scope {
  readonly values = new Map<string, StoredValue>();
  readonly declarations = new Map<string, TypeSpec>();
  readonly constants = new Set<string>();

  constructor(readonly parent?: Scope) {}

  declare(name: string, type: TypeSpec, line: number, constant = false, initialValue?: StoredValue) {
    if (this.declarations.has(name)) throw new AlgoError(`Variable '${name}' is already declared.`, line, 'Semantic Error');
    this.declarations.set(name, type);
    if (constant) this.constants.add(name);
    this.values.set(name, initialValue === undefined ? defaultValue(type) : initialValue);
  }

  hasLocal(name: string) {
    return this.declarations.has(name);
  }

  typeOf(name: string, line: number): TypeSpec {
    if (this.declarations.has(name)) return this.declarations.get(name)!;
    if (this.parent) return this.parent.typeOf(name, line);
    throw new AlgoError(`Variable '${name}' has not been declared.`, line, 'Semantic Error');
  }

  get(name: string, line: number): StoredValue {
    if (this.values.has(name)) return this.values.get(name);
    if (this.parent) return this.parent.get(name, line);
    throw new AlgoError(`Variable '${name}' has not been declared.`, line, 'Semantic Error');
  }

  set(name: string, value: StoredValue, line: number) {
    if (this.values.has(name)) {
      if (this.constants.has(name)) throw new AlgoError(`Constant '${name}' cannot be modified.`, line, 'Semantic Error');
      this.values.set(name, value);
      return;
    }
    if (this.parent) {
      this.parent.set(name, value, line);
      return;
    }
    throw new AlgoError(`Variable '${name}' has not been declared.`, line, 'Semantic Error');
  }
}

function defaultValue(type: TypeSpec): StoredValue {
  if (type.dimensions.length) {
    const [size, ...rest] = type.dimensions;
    return Array.from({ length: size + 1 }, (_, index) => index === 0 ? undefined : defaultValue({ base: type.base, dimensions: rest }));
  }
  if (type.base === 'String' || type.base === 'Character') return '';
  if (type.base === 'Boolean') return false;
  return 0;
}

function valueText(value: unknown): string {
  if (value === true) return 'True';
  if (value === false) return 'False';
  if (value === null || value === undefined) return '';
  if (Array.isArray(value)) return value.slice(1).map(valueText).join(' ');
  return String(value);
}

function isNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

type RunnerCallbacks = {
  onOutput: (text: string) => void;
  onPrompt: (request: InputRequest) => Promise<string>;
};

export class AlgoRunner {
  private stopped = false;
  private steps = 0;
  private readonly maxSteps = 100_000;

  constructor(private readonly program: Program, private readonly callbacks: RunnerCallbacks) {}

  stop() {
    this.stopped = true;
  }

  async run() {
    const scope = new Scope();
    for (const declaration of this.program.declarations) {
      for (let index = 0; index < declaration.names.length; index += 1) {
        const name = declaration.names[index];
        const initialValue = declaration.constant
          ? this.coerce(await this.evaluate(declaration.initializers?.[index] ?? declaration.initializers?.[0]!, scope), declaration.type, declaration.line)
          : undefined;
        scope.declare(name, declaration.type, declaration.line, declaration.constant, initialValue);
      }
    }
    await this.executeStatements(this.program.body, scope, false);
  }

  private tick(line: number) {
    if (this.stopped) throw new StopSignal();
    this.steps += 1;
    if (this.steps > this.maxSteps) throw new AlgoError('Possible infinite loop detected.', line, 'Runtime Error');
  }

  private async executeStatements(statements: Statement[], scope: Scope, insideFunction: boolean) {
    for (const statement of statements) {
      this.tick(statement.line);
      await this.executeStatement(statement, scope, insideFunction);
    }
  }

  private async executeStatement(statement: Statement, scope: Scope, insideFunction: boolean): Promise<void> {
    if (statement.kind === 'assign') {
      const value = await this.evaluate(statement.value, scope, this.targetType(statement.target.target, scope, statement.line));
      this.assign(statement.target.target, value, scope, statement.line);
      return;
    }
    if (statement.kind === 'read') {
      const request = this.inputRequest(statement.target.target, scope, statement.line);
      const raw = await this.callbacks.onPrompt(request);
      if (this.stopped) throw new StopSignal();
      const value = this.convertInput(raw, request.type, statement.line);
      this.assign(statement.target.target, value, scope, statement.line);
      return;
    }
    if (statement.kind === 'write') {
      const values = [];
      for (const expression of statement.expressions) values.push(valueText(await this.evaluate(expression, scope)));
      this.callbacks.onOutput(values.join(''));
      return;
    }
    if (statement.kind === 'expression') {
      await this.evaluate(statement.expression, scope);
      return;
    }
    if (statement.kind === 'return') {
      if (!insideFunction) throw new AlgoError('Return is only allowed inside a Function.', statement.line, 'Semantic Error');
      throw new ReturnSignal(statement.value ? await this.evaluate(statement.value, scope) : null);
    }
    if (statement.kind === 'if') {
      const branch = (await this.evaluate(statement.condition, scope)) === true ? statement.thenBody : statement.elseBody;
      await this.executeStatements(branch, scope, insideFunction);
      return;
    }
    if (statement.kind === 'for') {
      const start = await this.evaluate(statement.start, scope);
      const end = await this.evaluate(statement.end, scope);
      const step = await this.evaluate(statement.step, scope);
      if (!isNumber(start) || !isNumber(end) || !isNumber(step) || step === 0) throw new AlgoError('For loop bounds and Step must be numbers, and Step cannot be zero.', statement.line, 'Runtime Error');
      for (let value = start; step > 0 ? value <= end : value >= end; value += step) {
        this.assign(statement.target.target, value, scope, statement.line);
        await this.executeStatements(statement.body, scope, insideFunction);
        this.tick(statement.line);
      }
      return;
    }
    if (statement.kind === 'while') {
      while ((await this.evaluate(statement.condition, scope)) === true) {
        await this.executeStatements(statement.body, scope, insideFunction);
        this.tick(statement.line);
      }
      return;
    }
    if (statement.kind === 'repeat') {
      do {
        await this.executeStatements(statement.body, scope, insideFunction);
        this.tick(statement.line);
      } while ((await this.evaluate(statement.condition, scope)) !== true);
    }
  }

  private async evaluate(expression: Expr, scope: Scope, expectedType?: TypeSpec): Promise<unknown> {
    if (expression.kind === 'literal') return expression.value;
    if (expression.kind === 'identifier') return scope.get(expression.name, expression.line);
    if (expression.kind === 'index') return this.readIndex(expression, scope);
    if (expression.kind === 'unary') {
      const value = await this.evaluate(expression.operand, scope);
      if (expression.operator === 'NOT') return !Boolean(value);
      if (!isNumber(value)) throw new AlgoError('Unary arithmetic operators require a number.', expression.line, 'Runtime Error');
      return expression.operator === '-' ? -value : value;
    }
    if (expression.kind === 'call') {
      const args = [];
      for (const arg of expression.args) args.push(await this.evaluate(arg, scope));
      return this.call(expression.name, args, scope, expression.line);
    }
    const childExpectedType = expectedType && ['+', '-', '*', '/', '%', '^'].includes(expression.operator) ? expectedType : undefined;
    const left = await this.evaluate(expression.left, scope, childExpectedType);
    if (expression.operator === 'AND' && !Boolean(left)) return false;
    if (expression.operator === 'OR' && Boolean(left)) return true;
    const right = await this.evaluate(expression.right, scope, childExpectedType);
    switch (expression.operator) {
      case '+':
        if (typeof left === 'string' || typeof right === 'string') return valueText(left) + valueText(right);
        return this.numeric(left, right, expression.line, (a, b) => a + b);
      case '-': return this.numeric(left, right, expression.line, (a, b) => a - b);
      case '*': return this.numeric(left, right, expression.line, (a, b) => a * b);
      case '/':
        if (right === 0) throw new AlgoError('Cannot divide by zero.', expression.line, 'Runtime Error');
        return this.numeric(left, right, expression.line, (a, b) => {
          const integerDivision = expectedType?.base === 'Integer'
            || (expectedType?.base !== 'Real' && this.isIntegerExpression(expression.left, scope) && this.isIntegerExpression(expression.right, scope));
          return integerDivision ? Math.trunc(a / b) : a / b;
        });
      case 'DIV':
        if (right === 0) throw new AlgoError('Cannot divide by zero.', expression.line, 'Runtime Error');
        return this.numeric(left, right, expression.line, (a, b) => Math.trunc(a / b));
      case '%': return this.numeric(left, right, expression.line, (a, b) => a % b);
      case '^': return this.numeric(left, right, expression.line, (a, b) => a ** b);
      case '=':
      case '==': return left === right;
      case '<>':
      case '!=': return left !== right;
      case '<': return (left as number) < (right as number);
      case '>': return (left as number) > (right as number);
      case '<=': return (left as number) <= (right as number);
      case '>=': return (left as number) >= (right as number);
      case 'AND': return Boolean(left) && Boolean(right);
      case 'OR': return Boolean(left) || Boolean(right);
      default: throw new AlgoError(`Unknown operator '${expression.operator}'.`, expression.line);
    }
  }

  private numeric(left: unknown, right: unknown, line: number, operation: (a: number, b: number) => number) {
    if (!isNumber(left) || !isNumber(right)) throw new AlgoError('Arithmetic operators require numbers.', line, 'Runtime Error');
    return operation(left, right);
  }

  private isIntegerExpression(expression: Expr, scope: Scope): boolean {
    if (expression.kind === 'literal') return typeof expression.value === 'number' && expression.integer === true;
    if (expression.kind === 'identifier') return scope.typeOf(expression.name, expression.line).base === 'Integer';
    if (expression.kind === 'index') {
      const root = this.rootName(expression);
      return root ? scope.typeOf(root, expression.line).base === 'Integer' : false;
    }
    if (expression.kind === 'unary') return this.isIntegerExpression(expression.operand, scope);
    if (expression.kind === 'binary') {
      return ['+', '-', '*', '/', '%', '^', 'DIV'].includes(expression.operator)
        && this.isIntegerExpression(expression.left, scope)
        && this.isIntegerExpression(expression.right, scope);
    }
    if (expression.kind === 'call') {
      const builtin = upper(expression.name);
      if (['ABS', 'SQR', 'DIV', 'MIN', 'MAX'].includes(builtin)) {
        return expression.args.every((argument) => this.isIntegerExpression(argument, scope));
      }
      return false;
    }
    return false;
  }

  private targetType(target: Expr, scope: Scope, line: number): TypeSpec {
    const root = this.rootName(target);
    if (!root) throw new AlgoError('Invalid assignment target.', line);
    const type = scope.typeOf(root, line);
    if (target.kind === 'identifier') return type;
    if (target.kind !== 'index') throw new AlgoError('Invalid assignment target.', line);
    return { base: type.base, dimensions: type.dimensions.slice(this.allIndexes(target).length) };
  }

  private async call(name: string, args: unknown[], caller: Scope, line: number): Promise<unknown> {
    const builtin = upper(name);
    if (builtin === 'LENGTH') {
      if (args.length !== 1) throw new AlgoError('Length expects one argument.', line);
      return typeof args[0] === 'string' ? args[0].length : Array.isArray(args[0]) ? args[0].length - 1 : 0;
    }
    if (builtin === 'UPPER') return valueText(args[0]).toUpperCase();
    if (builtin === 'LOWER') return valueText(args[0]).toLowerCase();
    if (builtin === 'SUBSTRING') return valueText(args[0]).substring(Number(args[1]) - 1, Number(args[1]) - 1 + Number(args[2]));
    if (builtin === 'ABS') return Math.abs(Number(args[0]));
    if (builtin === 'SQRT') return Math.sqrt(Number(args[0]));
    if (builtin === 'SQR') return Math.pow(Number(args[0]), 2);
    if (builtin === 'POW' || builtin === 'POWER') return Math.pow(Number(args[0]), Number(args[1]));
    if (builtin === 'DIV') return Math.trunc(Number(args[0]) / Number(args[1]));
    if (builtin === 'MIN') return Math.min(Number(args[0]), Number(args[1]));
    if (builtin === 'MAX') return Math.max(Number(args[0]), Number(args[1]));
    if (builtin === 'ROUND') return Math.round(Number(args[0]));
    if (builtin === 'FLOOR') return Math.floor(Number(args[0]));
    if (builtin === 'CEIL') return Math.ceil(Number(args[0]));
    if (builtin === 'RANDOM') return Math.floor(Math.random() * (Number(args[1]) - Number(args[0]) + 1)) + Number(args[0]);
    const routine = this.program.routines.get(name.toLowerCase());
    if (!routine) throw new AlgoError(`Routine '${name}' has not been declared.`, line, 'Semantic Error');
    if (args.length !== routine.parameters.length) throw new AlgoError(`Routine '${name}' expects ${routine.parameters.length} argument(s).`, line, 'Runtime Error');
    const local = new Scope(caller);
    routine.parameters.forEach((parameter, index) => {
      local.declare(parameter.name, parameter.type, routine.line);
      local.set(parameter.name, args[index], routine.line);
    });
    for (const declaration of routine.declarations) {
      for (let index = 0; index < declaration.names.length; index += 1) {
        const namePart = declaration.names[index];
        const initialValue = declaration.constant
          ? this.coerce(await this.evaluate(declaration.initializers?.[index] ?? declaration.initializers?.[0]!, local), declaration.type, declaration.line)
          : undefined;
        local.declare(namePart, declaration.type, declaration.line, declaration.constant, initialValue);
      }
    }
    try {
      await this.executeStatements(routine.body, local, routine.kind === 'Function');
    } catch (error) {
      if (error instanceof ReturnSignal) return error.value;
      throw error;
    }
    if (routine.kind === 'Function') return null;
    return null;
  }

  private readIndex(expression: Extract<Expr, { kind: 'index' }>, scope: Scope) {
    const root = this.rootName(expression.target);
    if (!root) throw new AlgoError('Invalid array reference.', expression.line);
    let value = scope.get(root, expression.line);
    for (const indexExpression of this.allIndexes(expression)) {
      const index = this.toIndex(indexExpression, scope, expression.line);
      if (!Array.isArray(value) || index <= 0 || index >= value.length) throw new AlgoError('Array index out of range.', expression.line, 'Runtime Error');
      value = value[index];
    }
    return value;
  }

  private assign(target: Expr, value: unknown, scope: Scope, line: number) {
    const root = this.rootName(target);
    if (!root) throw new AlgoError('Invalid assignment target.', line);
    const type = scope.typeOf(root, line);
    if (target.kind === 'identifier') {
      scope.set(root, this.coerce(value, type, line), line);
      return;
    }
    if (target.kind !== 'index') throw new AlgoError('Invalid assignment target.', line);
    const indexes = this.allIndexes(target).map((index) => this.toIndexSync(index, scope, line));
    let container = scope.get(root, line);
    for (let index = 0; index < indexes.length - 1; index += 1) {
      const current = indexes[index];
      if (!Array.isArray(container) || current <= 0 || current >= container.length) throw new AlgoError('Array index out of range.', line, 'Runtime Error');
      container = container[current];
    }
    const last = indexes[indexes.length - 1];
    if (!Array.isArray(container) || last <= 0 || last >= container.length) throw new AlgoError('Array index out of range.', line, 'Runtime Error');
    container[last] = this.coerce(value, { base: type.base, dimensions: type.dimensions.slice(indexes.length) }, line);
  }

  private inputRequest(target: Expr, scope: Scope, line: number): InputRequest {
    const root = this.rootName(target);
    if (!root) throw new AlgoError('Read expects a variable or array element.', line);
    return { variable: root, type: scope.typeOf(root, line).base, line };
  }

  private convertInput(raw: string, type: BaseType, line: number) {
    const value = raw.trim();
    if (type === 'Integer') {
      if (!/^[+-]?\d+$/.test(value)) throw new AlgoError(`Expected an Integer but received '${raw}'.`, line, 'Runtime Error');
      return Number(value);
    }
    if (type === 'Real') {
      if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(value)) throw new AlgoError(`Expected a Real but received '${raw}'.`, line, 'Runtime Error');
      return Number(value);
    }
    if (type === 'Boolean') {
      if (/^true$/i.test(value)) return true;
      if (/^false$/i.test(value)) return false;
      throw new AlgoError(`Expected True or False but received '${raw}'.`, line, 'Runtime Error');
    }
    if (type === 'Character') {
      if (value.length !== 1) throw new AlgoError('Expected one character.', line, 'Runtime Error');
      return value;
    }
    return raw;
  }

  private coerce(value: unknown, type: TypeSpec, line: number) {
    if (type.dimensions.length) return value;
    if (type.base === 'Real' && isNumber(value)) return value;
    if (type.base === 'Integer' && typeof value === 'number' && Number.isInteger(value)) return value;
    if (type.base === 'String' && typeof value === 'string') return value;
    if (type.base === 'Character' && typeof value === 'string' && value.length <= 1) return value;
    if (type.base === 'Boolean' && typeof value === 'boolean') return value;
    throw new AlgoError(`Cannot assign ${typeof value === 'string' ? 'String' : 'value'} to ${type.base}.`, line, 'Semantic Error');
  }

  private rootName(expression: Expr): string | null {
    if (expression.kind === 'identifier') return expression.name;
    if (expression.kind === 'index') return this.rootName(expression.target);
    return null;
  }

  private toIndex(expression: Expr, scope: Scope, line: number) {
    return this.toIndexSync(expression, scope, line);
  }

  private toIndexSync(expression: Expr, scope: Scope, line: number) {
    const value = this.evaluateSync(expression, scope);
    if (!Number.isInteger(value)) throw new AlgoError('Array indexes must be integers.', line, 'Runtime Error');
    return value as number;
  }

  private evaluateSync(expression: Expr, scope: Scope): unknown {
    if (expression.kind === 'literal') return expression.value;
    if (expression.kind === 'identifier') return scope.get(expression.name, expression.line);
    if (expression.kind === 'unary') {
      const value = this.evaluateSync(expression.operand, scope);
      return expression.operator === '-' ? -Number(value) : Number(value);
    }
    if (expression.kind === 'index') return this.readIndexSync(expression, scope);
    throw new AlgoError('Array index expressions must be simple.', lineOf(expression));
  }

  private readIndexSync(expression: Extract<Expr, { kind: 'index' }>, scope: Scope) {
    const root = this.rootName(expression.target);
    if (!root) throw new AlgoError('Invalid array reference.', expression.line);
    let value = scope.get(root, expression.line);
    for (const indexExpression of this.allIndexes(expression)) {
      const index = this.toIndexSync(indexExpression, scope, expression.line);
      if (!Array.isArray(value) || index <= 0 || index >= value.length) throw new AlgoError('Array index out of range.', expression.line, 'Runtime Error');
      value = value[index];
    }
    return value;
  }

  private allIndexes(expression: Extract<Expr, { kind: 'index' }>): Expr[] {
    const parentIndexes = expression.target.kind === 'index' ? this.allIndexes(expression.target) : [];
    return [...parentIndexes, ...expression.indexes];
  }
}

function lineOf(expression: Expr) {
  return expression.line;
}
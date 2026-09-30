import assert from 'node:assert/strict';
import { AlgoError, AlgoRunner, parseProgram } from '/tmp/english-algo-runner-test/interpreter.js';

async function run(source, inputs = []) {
  const output = [];
  let inputIndex = 0;
  const program = parseProgram(source);
  const runner = new AlgoRunner(program, {
    onOutput: (text) => output.push(text),
    onPrompt: async () => inputs[inputIndex++] ?? '',
  });
  await runner.run();
  return output;
}

const addition = `Algorithm Addition
Variables
    a, b : Integer
Begin
    a <- 5
    b <- 10
    Write("Result = ", a + b)
End`;
assert.deepEqual(await run(addition), ['Result = 15']);

const integerMath = `Algorithm IntegerMath
Variables
    a, b, quotient, remainder : Integer
    realQuotient, decimalLiteralQuotient : Real
Begin
    a <- 12
    b <- 5
    quotient <- a / b
    remainder <- a % b
    realQuotient <- a / b
    decimalLiteralQuotient <- 12.0 / 5.0
    Write(quotient, " ", a DIV b, " ", remainder, " ", realQuotient, " ", decimalLiteralQuotient)
    Write(ABS(-8), " ", SQRT(16), " ", POWER(2, 3), " ", SQR(6), " ", MIN(a, b), " ", MAX(a, b))
End`;
assert.deepEqual(await run(integerMath), ['2 2 2 2.4 2.4', '8 4 8 36 5 12']);

const destinationTypedDivision = `Algorithm DestinationTypedDivision
Variables
    a, b, integerResult : Integer
    realResult : Real
Begin
    a <- 12
    b <- 5
    integerResult <- a / b
    realResult <- a / b
    Write(integerResult, " ", realResult)
End`;
assert.deepEqual(await run(destinationTypedDivision), ['2 2.4']);

const constants = `Algorithm Constants
Constants
    MaxAttempts : Integer <- 3
    Pi : Real = 3.14159
Variables
    radius : Real
Begin
    radius <- 2
    Write(MaxAttempts, " ", Pi, " ", Pi * radius * radius)
End`;
assert.deepEqual(await run(constants), ['3 3.14159 12.56636']);

await assert.rejects(() => run(`Algorithm Immutable
Constants
    Limit : Integer <- 5
Begin
    Limit <- 6
End`), (error) => error instanceof AlgoError && error.message.includes('Constant') && error.message.includes('cannot be modified'));

const branching = `algorithm Branching
Variables
    age : Integer
Begin
    Read(age)
    If age >= 18 AND age <= 60 Then
        Write("Allowed")
    Else
        Write("Not allowed")
    EndIf
End`;
assert.deepEqual(await run(branching, ['20']), ['Allowed']);

const loops = `Algorithm Loops
Variables
    i, total : Integer
Begin
    total <- 0
    For i <- 5 To 1 Step -2 Do
        total <- total + i
    EndFor
    Write(total)
End`;
assert.deepEqual(await run(loops), ['9']);

const arrays = `Algorithm Arrays
Variables
    matrix : Integer[2][2]
    i, j : Integer
Begin
    For i <- 1 To 2 Do
        For j <- 1 To 2 Do
            matrix[i][j] <- i * j
        EndFor
    EndFor
    Write(matrix[1][2], " ", matrix[2][2])
End`;
assert.deepEqual(await run(arrays), ['2 4']);

const routines = `Algorithm Routines
Function Square(value : Integer) : Integer
Begin
    Return value ^ 2
EndFunction
Procedure Greet()
Begin
    Write("Hello")
EndProcedure
Variables
    result : Integer
Begin
    Greet()
    result <- Square(6)
    Write(result)
End`;
assert.deepEqual(await run(routines), ['Hello', '36']);

const repeat = `Algorithm RepeatTest
Variables
    value : Integer
Begin
    value <- 0
    Repeat
        value <- value + 1
    Until value = 3
    Write(value)
End`;
assert.deepEqual(await run(repeat), ['3']);

assert.throws(() => parseProgram(`Algorithm MissingDo
Variables
    i : Integer
Begin
    For i <- 1 To 3
        Write(i)
    EndFor
End`), (error) => error instanceof AlgoError && error.line === 5 && error.message.includes('Expected Do'));

assert.throws(() => parseProgram(`Algorithm MissingThen
Begin
    If True
        Write("no")
    EndIf
End`), (error) => error instanceof AlgoError && error.message.includes('Expected Then'));

await assert.rejects(() => run(`Algorithm Undeclared
Begin
    value <- 5
End`), (error) => error instanceof AlgoError && error.message.includes('has not been declared'));

await assert.rejects(() => run(`Algorithm Infinite
Variables
    value : Integer
Begin
    value <- 1
    While value = 1 Do
        Write("loop")
    EndWhile
End`), (error) => error instanceof AlgoError && error.message.includes('Possible infinite loop'));

console.log('Interpreter tests passed: lexer, parser, expressions, variables, constants, input, output, branches, loops, routines, arrays, errors, and loop protection.');
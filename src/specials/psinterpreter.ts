import { Machine } from '../machine';
import Matrix from '../matrix';

// Postscript interpreter.
// Most postscript is not implemented.
// There is enough implemented to perform the basic operations that result from the LaTeX commands \scalebox,
// \rotatebox, and \resizebox, and a little more that is incomplete and mostly untested.
export default class PSInterpreter {
	private machine: Machine;
	private stack: StackObject[];
	private psInput: string;
	private static stateQueue: Matrix[] = [];

	constructor(machine: Machine, psInput: string) {
		this.machine = machine;
		this.psInput = psInput;
		this.stack = [];
	}

	interpret(machine: Machine) {
		for (const token of tokens(this.psInput)) {
			// Numeric literals
			if (/^[+-]?\d+(\.\d*)?$/.test(token)) {
				this.stack.push(new PSNumber(token));
				continue;
			}
			// String literals
			if (token[0] == '(') {
				this.stack.push(new PSString(token));
				continue;
			}
			// Array start (same as a mark)
			if (token == '[') {
				PSInterpreter.operators.mark(this);
				continue;
			}
			// Array end
			if (token == ']') {
				let array = new PSArray();
				let elt = this.stack.pop();
				while (!elt.name || elt.name != 'mark') { array.push(elt); }
				this.stack.push(array);
			}
			// Identifiers (i.e. Variables)
			if (token[0] == "/") {
				this.stack.push(new PSIdentifier(token));
			}
			// Procedures
			if (token[0] == '{') {
				this.stack.push(new PSProcedure(token));
			}
			// Operators
			if (token in PSInterpreter.operators) {
				PSInterpreter.operators[token](this);
				continue;
			}
			throw Error("Invalid or unimplemented postscript expression");
		}
	}

	// The value of each key is the number of parameters from the stack it needs.
	private static operators = {
		// Stack operators
		pop: (interpreter: PSInterpreter) => { interpreter.stack.pop(); },

		exch: (interpreter: PSInterpreter) => {
			let a1 = interpreter.stack.pop();
			let a2 = interpreter.stack.pop();
			interpreter.stack.push(a1);
			interpreter.stack.push(a2);
		},

		dup: (interpreter: PSInterpreter) => {
			interpreter.stack.push(interpreter.stack[interpreter.stack.length - 1]);
		},

		mark: (interpreter: PSInterpreter) => {
			interpreter.stack.push(new PSMark());
		},

		// Math operators
		neg: (interpreter: PSInterpreter) => {
			let x = interpreter.stack.pop();
			interpreter.stack.push(new PSNumber(-x.value));
		},

		add: (interpreter: PSInterpreter) => {
			let x = interpreter.stack.pop();
			let y = interpreter.stack.pop();
			interpreter.stack.push(new PSNumber(x.value + y.value));
		},

		sub: (interpreter: PSInterpreter) => {
			let x = interpreter.stack.pop();
			let y = interpreter.stack.pop();
			interpreter.stack.push(new PSNumber(y.value - x.value));
		},

		mul: (interpreter: PSInterpreter) => {
			let x = interpreter.stack.pop();
			let y = interpreter.stack.pop();
			interpreter.stack.push(new PSNumber(x.value * y.value));
		},

		div: (interpreter: PSInterpreter) => {
			let x = interpreter.stack.pop();
			let y = interpreter.stack.pop();
			interpreter.stack.push(new PSNumber(y.value / x.value));
		},

		// Graphics state operators
		gsave: (interpreter: PSInterpreter) => {
			PSInterpreter.stateQueue.push(new Matrix(interpreter.machine.matrix));
		},

		grestore: (interpreter: PSInterpreter) => {
			interpreter.machine.matrix = PSInterpreter.stateQueue.pop();
		},

		// Path construction operators
		currentpoint: (interpreter: PSInterpreter) => {
			interpreter.stack.push(...interpreter.machine.getCurrentPosition().map(coord => new PSNumber(coord)));
		},

		moveto: (interpreter: PSInterpreter) => {
			let y = interpreter.stack.pop();
			let x = interpreter.stack.pop();
			interpreter.machine.setCurrentPosition(x.value, y.value);
		},

		// Coordinate system and matrix operators
		scale: (interpreter: PSInterpreter) => {
			let y = interpreter.stack.pop();
			let x = interpreter.stack.pop();
			interpreter.machine.matrix.scale(x.value, y.value);
		},

		translate: (interpreter: PSInterpreter) => {
			let y = interpreter.stack.pop();
			let x = interpreter.stack.pop();
			interpreter.machine.matrix.translate(x.value, y.value);
		},

		rotate: (interpreter: PSInterpreter) => {
			// r is in degrees
			let r = interpreter.stack.pop();
			interpreter.machine.matrix.rotate(r.value);
		}
	}
}

// Parse a string into tokens.  This method attempts to emulate ghostscript's parsing.
function* tokens(input: string) {
	let token = "";
	let stringLevel = 0;
	let procedureLevel = 0;

	let charGen = (function*() { for (const c of input) yield c; })();
	for (const character of charGen) {
		let nextChar = undefined;
		switch (character) {
			case ' ': // White space characters
			case '\t':
			case '\n':
				if (procedureLevel) {
					if (token[token.length - 1] != ' ') token += ' ';
				} else if (stringLevel) {
					switch (character) {
						case ' ': token += ' '; break;
						case '\n': token += '\\n'; break;
						case '\t': token += '\\t'; break;
					}
				} else if (token) {
					yield token;
					token = "";
				}
				continue;
			case '[': // Array delimiters
			case ']':
				if (!procedureLevel && !stringLevel) {
					if (token) yield token;
					token = "";
					yield character;
				} else {
					token += character;
				}
				continue;
			case '{': // Procedure delimiters
				if (!stringLevel) {
					if (procedureLevel == 0 && token) yield token;
					++procedureLevel;
				}
				token += character;
				continue;
			case '}':
				token += character;
				if (stringLevel) continue;
				--procedureLevel;
				if (!procedureLevel) {
					yield token;
					token = ""
				}
				continue;
			case '(': // String delimiters
				++stringLevel;
				if (token && !procedureLevel && stringLevel == 1) yield token;
				if (stringLevel > 1) token += '\\';
				token += character;
				continue;
			case ')':
				--stringLevel;
				if (stringLevel) token += '\\';
				token += character;
				if (!procedureLevel && !stringLevel) {
					yield token;
					token = ""
				}
				continue;
			case '\\': // Escape character
				token += character;
				nextChar = charGen.next();
				if (nextChar.done) throw Error("Invalid escape character.");
				if (!nextChar.done) token += nextChar.value;
				continue;
			case '/': // Name start
				if (!procedureLevel && !stringLevel && token) yield token;
				token += character;
				continue;
			case '%': // Comments
				do {
					nextChar = charGen.next();
				} while (!nextChar.done && nextChar.value != '\n');
				continue;
			default: // Any other character
				token += character;
		}
	}
	if (token) yield token;
}

// Postscript stack objects
abstract class StackObject {
	name: string;
	value: any;
	constructor(name: string) { this.name = name; }
}

// Stack number
class PSNumber extends StackObject {
	constructor(value: number | string) {
		super("number");
		if (typeof value === "number")
			this.value = value;
		else if (typeof value === "string")
			this.value = parseFloat(value);
	}
}

// Stack string
class PSString extends StackObject {
	constructor(value: string) {
		super("string");
		this.value = value.replace(/^\(|\)$/g, "");
	}
}

// Stack array
class PSArray extends StackObject {
	constructor(value?: StackObject[]) {
		super("array");
		this.value = value || [];
	}

	push(elt: StackObject) {
		this.value.push(elt);
	}

	pop(): StackObject {
		return this.value.pop();
	}
}

// Stack mark
class PSMark extends StackObject {
	constructor() {
		super("mark");
		this.value = "-mark-";
	}
}

// Stack identifier
class PSIdentifier extends StackObject {
	constructor(value: string) {
		super("identifier");
		this.value = value.replace(/^\//, "");
	}
}

// Stack procedure object
class PSProcedure extends StackObject {
	constructor(value: string) {
		super("procedure");
		this.value = value;
	}
}

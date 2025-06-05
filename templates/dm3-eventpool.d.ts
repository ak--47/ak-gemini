interface ValueFrequency {
	value: string;
	frequency: number; 
  }
  
  interface NumberValues {
	min: number;
	max: number;
	median: number; 
	allowDecimals: false;
  }
  
  interface DateValues {
	first: string; // Date is represented as a string
	last: string;
	middle: string;
  }
  
  interface Property {
	propName: string;
	dataType: "string" | "number" | "bool" | "date" | "object";
	values: ValueFrequency[] | NumberValues | DateValues | Property[] | string; 
	maxItems?: string; // Only for object dataType
  }
  
  interface Event {
	eventName: string;
	properties: Property[];
  }
  
  type Events = Event[];
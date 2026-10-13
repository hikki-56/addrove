import { useReceiveMovement } from '@/features/receive/hooks/use-receive-movement';
import type { Product, Location } from '@/types/models';
let mockCursor = 0;
let mockCells: unknown[] = [];
let mockData: Record<string, any>;
let mockFields: Record<string, any>[] = [];
let mockId = 0;
const mockSetValue = (path: string, value: unknown) => {
  const parts = path.split('.');
  let target = mockData;
  for (const part of parts.slice(0, -1)) target = target[part];
  target[parts.at(-1)!] = value;
};
jest.mock('react', () => ({
  useEffect: jest.fn(),
  useCallback: (callback: unknown) => callback,
  useRef: (initial: unknown) => {
    const index = mockCursor++;
    if (!(index in mockCells)) mockCells[index] = { current: initial };
    return mockCells[index];
  },
  useState: (initial: unknown) => {
    const index = mockCursor++;
    if (!(index in mockCells)) mockCells[index] = initial;
    return [mockCells[index], (value: unknown) => {
      mockCells[index] = typeof value === 'function' ? value(mockCells[index]) : value;
    }];
  },
}));
jest.mock('react-hook-form', () => ({
  useForm: ({ defaultValues }: {defaultValues: Record<string, unknown>}) => {
    mockData ||= structuredClone(defaultValues);
    return {
      register: jest.fn(), control: {}, handleSubmit: jest.fn(), setValue: mockSetValue,
      watch: (path: string) => mockData[path],
      getValues: (path?: string) => path ? mockData[path] : mockData,
      reset: jest.fn(), formState: { errors: {}, isSubmitting: false },
    };
  },
  useFieldArray: () => ({
    fields: mockFields,
    insert: (index: number, line: Record<string, unknown>) => {
      mockData.lines.splice(index, 0, structuredClone(line));
      mockFields.splice(index, 0, {...line, id: `field-${++mockId}`});
    },
    remove: (index: number) => { mockData.lines.splice(index, 1); mockFields.splice(index, 1); },
    move: (from: number, to: number) => {
      mockData.lines.splice(to, 0, mockData.lines.splice(from, 1)[0]);
      mockFields.splice(to, 0, mockFields.splice(from, 1)[0]);
    },
  }),
}));
jest.mock('@/context/TabAuthContext', () => ({ useTabAuth: () => ({user: {id: 'test', name: 'Test',role:'ADMIN'}}) }));
jest.mock('uuid', () => ({v4: () => 'test-id'}));
const products = [1,2,3].map(n => ({ product_id: `prod-test-${n}`,sku:`TEST-${n}`,barcode:`TEST00${n}`,product_name:`สินค้าทดสอบ ${n}` })) as Product[];
const locations = [{location_id:'loc-a',location_code:'A1',location_name:'A1',warehouse_id:'wh-01'}] as Location[];
function render() {
  mockCursor = 0;
  // eslint-disable-next-line react-hooks/rules-of-hooks -- React hooks are mocked by this state-transition harness.
  return useReceiveMovement({activeWhId:'wh-01',setActiveWhId:jest.fn(),locations,products,setProducts:jest.fn(),refreshWarehouseData:jest.fn()});
}
beforeEach(() => {mockCells=[]; mockData=undefined as unknown as Record<string,any>;mockFields=[];mockId=0;jest.useFakeTimers();});
afterEach(() => {jest.clearAllTimers();jest.useRealTimers();});
async function confirmFirst() {
  let hook=render();await hook.handleScanBarcode('TEST001');hook=render();await hook.handleScanLocationForLine(0,'A1');hook.form.setValue('lines.0.qty',3);hook=render();hook.toggleConfirmLine(0);return render();
}
test('scan after confirming keeps confirmation and location attached to the original product',async()=>{
  let hook=await confirmFirst();await hook.handleScanBarcode('TEST002');hook=render();
  expect(mockData.lines.map((l: any)=>l.product_id)).toEqual(['prod-test-2','prod-test-1']);
  expect(hook.confirmedLines[0]).not.toBe(true);expect(hook.confirmedLines[1]).toBe(true);
  expect(hook.locationInputs[0]).toBeUndefined();expect(hook.locationInputs[1]).toBe('A1');
  expect(mockData.lines[0]).toMatchObject({qty:0,location_id:''});expect(mockData.lines[1]).toMatchObject({qty:3,location_id:'A1'});
});
test('selecting a new product after confirming preserves the original confirmation',async()=>{
  let hook=await confirmFirst();hook.handleProductSelect(products[1]);hook=render();
  expect(hook.confirmedLines[0]).not.toBe(true);expect(hook.confirmedLines[1]).toBe(true);expect(hook.locationInputs[1]).toBe('A1');
});
test('inserting a location row in the middle carries later confirmed lines with their products',async()=>{
  let hook=render();await hook.handleScanBarcode('TEST001');hook=render();await hook.handleScanLocationForLine(0,'A1');hook.form.setValue('lines.0.qty',2);hook=render();hook.toggleConfirmLine(0);
  hook=render();await hook.handleScanBarcode('TEST002');hook=render();hook.handleAddLocationForProduct(0);hook=render();
  expect(mockData.lines.map((l: any)=>l.product_id)).toEqual(['prod-test-2','prod-test-2','prod-test-1']);
  expect(hook.confirmedLines[0]).not.toBe(true);expect(hook.confirmedLines[1]).not.toBe(true);expect(hook.confirmedLines[2]).toBe(true);expect(hook.locationInputs[2]).toBe('A1');
});

export interface NodeBodyProps<T> {
  data: T;
  onChange: (patch: Partial<T>) => void;
}

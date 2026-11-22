import { Download } from 'lucide-react';
import { toast } from 'sonner';
import { downloadTable, type Cell } from '@/lib/export';
import { Button } from './button';
import { Dropdown, DropdownItem } from './dropdown';

/** Export button with Excel/CSV choice. `rows` is evaluated lazily on click; first row = header. */
export function ExportMenu({ baseName, rows, sheetName, disabled, size = 'md', className }: {
  baseName: string; rows: () => Cell[][] | Promise<Cell[][]>; sheetName?: string; disabled?: boolean; size?: 'sm' | 'md'; className?: string;
}) {
  const run = async (format: 'csv' | 'xlsx') => {
    try {
      downloadTable(format, baseName, await rows(), sheetName);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'ส่งออกไม่สำเร็จ');
    }
  };
  return (
    <Dropdown
      trigger={<Button variant="outline" size={size} disabled={disabled} className={className}><Download /> ส่งออก</Button>}
    >
      <DropdownItem onSelect={() => void run('xlsx')}>Excel (.xlsx)</DropdownItem>
      <DropdownItem onSelect={() => void run('csv')}>CSV</DropdownItem>
    </Dropdown>
  );
}

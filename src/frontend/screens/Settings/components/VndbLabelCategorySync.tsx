import { MenuItem } from '@mui/material'
import type {
  VndbCategoryLabelSyncMode,
  VndbLabelCategorySyncMode
} from 'common/types'
import { SelectField } from 'frontend/components/UI'
import useSetting from 'frontend/hooks/useSetting'
import { useTranslation } from 'react-i18next'

export default function VndbLabelCategorySync() {
  const { t } = useTranslation()
  const [enableVndbIntegration] = useSetting('enableVndbIntegration', true)
  const [labelToCategoryMode, setLabelToCategoryMode] = useSetting(
    'vndbLabelCategorySyncMode',
    'ask'
  )
  const [categoryToLabelMode, setCategoryToLabelMode] = useSetting(
    'vndbCategoryLabelSyncMode',
    'ask'
  )

  return (
    <>
      <SelectField
        htmlId="vndbLabelCategorySyncMode"
        value={labelToCategoryMode}
        disabled={!enableVndbIntegration}
        onChange={(event) =>
          setLabelToCategoryMode(
            event.target.value as VndbLabelCategorySyncMode
          )
        }
        label={t(
          'setting.vndbLabelCategorySyncMode.label',
          'When VNDB labels change'
        )}
      >
        <MenuItem value="ask">
          {t('setting.vndbLabelCategorySyncMode.ask', 'Ask before changing')}
        </MenuItem>
        <MenuItem value="automatic">
          {t(
            'setting.vndbLabelCategorySyncMode.automatic',
            'Always change automatically'
          )}
        </MenuItem>
        <MenuItem value="disabled">
          {t('setting.vndbLabelCategorySyncMode.disabled', 'Disabled')}
        </MenuItem>
      </SelectField>
      <SelectField
        htmlId="vndbCategoryLabelSyncMode"
        value={categoryToLabelMode}
        disabled={!enableVndbIntegration}
        onChange={(event) =>
          setCategoryToLabelMode(
            event.target.value as VndbCategoryLabelSyncMode
          )
        }
        label={t(
          'setting.vndbCategoryLabelSyncMode.label',
          'When library categories change'
        )}
      >
        <MenuItem value="ask">
          {t('setting.vndbCategoryLabelSyncMode.ask', 'Ask before changing')}
        </MenuItem>
        <MenuItem value="disabled">
          {t('setting.vndbCategoryLabelSyncMode.disabled', 'Disabled')}
        </MenuItem>
      </SelectField>
    </>
  )
}

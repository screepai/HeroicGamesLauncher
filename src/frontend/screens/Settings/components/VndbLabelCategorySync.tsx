import { MenuItem } from '@mui/material'
import type {
  VndbCategoryLabelSyncMode,
  VndbLabelCategorySyncMode
} from 'common/types'
import { SelectField } from 'frontend/components/UI'
import useHasVndbApiToken from 'frontend/hooks/useHasVndbApiToken'
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
  const hasVndbApiToken = useHasVndbApiToken(enableVndbIntegration)
  const isTokenGated = !enableVndbIntegration || !hasVndbApiToken
  const tokenRequiredMessage = t(
    'setting.vndbTokenRequired',
    'Requires a VNDB API token.'
  )

  return (
    <>
      <SelectField
        htmlId="vndbLabelCategorySyncMode"
        value={labelToCategoryMode}
        disabled={isTokenGated}
        onChange={(event) =>
          setLabelToCategoryMode(
            event.target.value as VndbLabelCategorySyncMode
          )
        }
        label={t(
          'setting.vndbLabelCategorySyncMode.label',
          'When VNDB labels change'
        )}
        afterSelect={
          enableVndbIntegration && !hasVndbApiToken ? (
            <span className="smallMessage">{tokenRequiredMessage}</span>
          ) : undefined
        }
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
        disabled={isTokenGated}
        onChange={(event) =>
          setCategoryToLabelMode(
            event.target.value as VndbCategoryLabelSyncMode
          )
        }
        label={t(
          'setting.vndbCategoryLabelSyncMode.label',
          'When library categories change'
        )}
        afterSelect={
          enableVndbIntegration && !hasVndbApiToken ? (
            <span className="smallMessage">{tokenRequiredMessage}</span>
          ) : undefined
        }
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

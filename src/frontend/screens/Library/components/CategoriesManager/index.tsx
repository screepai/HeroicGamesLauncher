import { useContext, useState } from 'react'
import {
  DragDropContext,
  Draggable,
  DraggableProvidedDragHandleProps,
  Droppable,
  DropResult
} from '@hello-pangea/dnd'
import { useTranslation } from 'react-i18next'
import LibraryContext from '../../LibraryContext'
import ContextProvider from 'frontend/state/ContextProvider'
import { Modal, ModalContent, ModalHeader } from 'frontend/components/UI/Modal'
import { Icon, TextInputField } from 'frontend/components/UI'
import Button from 'frontend/components/UI/Button'
import type { GameInfo } from 'common/types'
import './index.css'
import { Check, GripVertical, Pencil, Plus, Trash2, X } from 'lucide-react'
import useVndbCategoryLabelSync from 'frontend/hooks/useVndbCategoryLabelSync'

interface CategoryItemProps {
  name: string
  removeFunction: (name: string) => void
  renameFunction: (oldName: string, newName: string) => void
  dragHandleProps: DraggableProvidedDragHandleProps | null
  isDragging: boolean
}

interface CategoriesManagerProps {
  games?: GameInfo[]
  onClose?: () => void
}

function CategoryItem({
  name,
  removeFunction,
  renameFunction,
  dragHandleProps,
  isDragging
}: CategoryItemProps) {
  const { t } = useTranslation()
  const [renameMode, setRenameMode] = useState(false)
  const [newName, setNewName] = useState(name)
  const [removeMode, setRemoveMode] = useState(false)
  const isNewNameEmptyOrEqualsOldName =
    newName.trim() === '' || newName === name

  const rename = () => {
    renameFunction(name, newName)
    setRenameMode(false)
    setNewName(newName)
  }

  const cancelEdit = () => {
    setRenameMode(false)
    setNewName(name)
  }

  const remove = () => {
    removeFunction(name)
  }

  const leftButton = () => {
    if (renameMode) {
      return (
        <Button
          size="sm"
          onClick={() => rename()}
          title={t(
            'categories-manager.confirm-rename',
            'Confirm rename of "{{oldName}}" as "{{newName}}"',
            { oldName: name, newName }
          )}
          disabled={isNewNameEmptyOrEqualsOldName}
          icon={<Icon glyph={Check} size="md" />}
        />
      )
    } else if (removeMode) {
      return (
        <Button
          size="sm"
          variant="dangerSubtle"
          onClick={() => remove()}
          title={t(
            'categories-manager.confirm-remove',
            'Confirm removal of "{{name}}"',
            { name }
          )}
          icon={<Icon glyph={Check} size="md" />}
        />
      )
    } else {
      return (
        <Button
          size="sm"
          variant="dangerSubtle"
          onClick={() => setRemoveMode(true)}
          title={t('categories-manager.remove', 'Remove "{{name}}"', { name })}
          icon={<Icon glyph={Trash2} size="md" />}
        />
      )
    }
  }

  const rightButton = () => {
    if (renameMode) {
      return (
        <Button
          size="sm"
          variant="secondary"
          onClick={() => cancelEdit()}
          title={t(
            'categories-manager.cancel-rename',
            'Cancel rename of "{{name}}"',
            { name }
          )}
          icon={<Icon glyph={X} size="md" />}
        />
      )
    } else if (removeMode) {
      return (
        <Button
          size="sm"
          variant="secondary"
          onClick={() => setRemoveMode(false)}
          title={t(
            'categories-manager.cancel-remove',
            'Cancel removal of "{{name}}"',
            { name }
          )}
          icon={<Icon glyph={X} size="md" />}
        />
      )
    } else {
      return (
        <Button
          size="sm"
          variant="secondary"
          onClick={() => setRenameMode(true)}
          title={t('categories-manager.rename', 'Rename "{{name}}"', { name })}
          icon={<Icon glyph={Pencil} size="md" />}
        />
      )
    }
  }

  return (
    <div className={`Category${isDragging ? ' isDragging' : ''}`}>
      <button
        type="button"
        className="button is-secondary Category__dragHandle"
        title={t('categories-manager.reorder', 'Reorder "{{name}}"', { name })}
        {...dragHandleProps}
      >
        <Icon glyph={GripVertical} size="md" />
      </button>
      {!renameMode && <span>{name}</span>}

      {renameMode && (
        <TextInputField
          htmlId={`edit-${name.replace(' ', '-')}`}
          value={newName}
          onChange={(newValue) => setNewName(newValue)}
          label={t('categories-manager.rename', 'Rename "{{name}}"', { name })}
        />
      )}

      {leftButton()}
      {rightButton()}
    </div>
  )
}

const reorderCategories = (
  categories: string[],
  sourceIndex: number,
  destinationIndex: number
) => {
  const reordered = [...categories]
  const [movedCategory] = reordered.splice(sourceIndex, 1)
  reordered.splice(destinationIndex, 0, movedCategory)
  return reordered
}

function CategoriesManager({ games, onClose }: CategoriesManagerProps) {
  const { t } = useTranslation()
  const { customCategories } = useContext(ContextProvider)
  const requestCategoryLabelSync = useVndbCategoryLabelSync()

  const { setShowCategories } = useContext(LibraryContext)

  const [newCategoryName, setNewCategoryName] = useState('')

  const isCategoryNameEmpty = newCategoryName.trim() === ''

  const removeCategory = (cat: string) => {
    customCategories.removeCategory(cat)
  }

  const addCategory = () => {
    setNewCategoryName('')
    customCategories.addCategory(newCategoryName)
  }

  const renameCategory = (oldName: string, newName: string) => {
    customCategories.renameCategory(oldName, newName)
  }

  const categories = customCategories.listCategories()
  const selectedGameIds =
    games?.map((game) => `${game.app_name}_${game.runner}`) ?? []
  const isBulkMode = selectedGameIds.length > 0
  const close = () => {
    if (onClose) {
      onClose()
    } else {
      setShowCategories(false)
    }
  }

  const getAssignedGameCount = (category: string) => {
    const gamesInCategory = new Set(customCategories.list[category] ?? [])
    return selectedGameIds.filter((gameId) => gamesInCategory.has(gameId))
      .length
  }

  const toggleBulkCategory = (category: string) => {
    const assignedToAll =
      getAssignedGameCount(category) === selectedGameIds.length
    const setGamesMembership = customCategories.setGamesMembership as (
      category: string,
      gameIds: string[],
      isAssigned: boolean
    ) => void

    setGamesMembership(category, selectedGameIds, !assignedToAll)
    if (games) {
      void requestCategoryLabelSync(games, category, !assignedToAll)
    }
  }

  const addBulkCategory = () => {
    const category = newCategoryName.trim()
    if (!category) {
      return
    }

    const setGamesMembership = customCategories.setGamesMembership as (
      category: string,
      gameIds: string[],
      isAssigned: boolean
    ) => void

    setGamesMembership(category, selectedGameIds, true)
    if (games) {
      void requestCategoryLabelSync(games, category, true)
    }
    setNewCategoryName('')
  }

  const handleDragEnd = ({ source, destination }: DropResult) => {
    if (!destination || destination.index === source.index) {
      return
    }

    customCategories.setCategoryOrder(
      reorderCategories(categories, source.index, destination.index)
    )
  }

  return (
    <Modal
      showCloseButton
      size="sm"
      onClose={close}
      className="CategoriesManager__modal"
    >
      <ModalHeader>
        <div>
          {isBulkMode
            ? t('categories-manager.bulk-title', 'Categorize {{count}} games', {
                count: selectedGameIds.length
              })
            : t('categories-manager.title', 'Manage Categories')}
        </div>
      </ModalHeader>
      <ModalContent>
        {isBulkMode ? (
          <div className="CategoriesManager__BulkList">
            {categories.map((category) => {
              const assignedCount = getAssignedGameCount(category)
              const assignedToAll = assignedCount === selectedGameIds.length

              return (
                <button
                  className={`CategoriesManager__BulkCategory${
                    assignedToAll ? ' isAssigned' : ''
                  }`}
                  key={category}
                  onClick={() => toggleBulkCategory(category)}
                  aria-pressed={assignedToAll}
                >
                  <span>{category}</span>
                  <span>
                    {assignedCount}/{selectedGameIds.length}
                    {assignedToAll && <Icon glyph={Check} size="sm" />}
                  </span>
                </button>
              )
            })}
          </div>
        ) : (
          <DragDropContext onDragEnd={handleDragEnd}>
            <Droppable droppableId="categories-manager-list">
              {(provided) => (
                <div
                  className="CategoriesManager__List"
                  ref={provided.innerRef}
                  {...provided.droppableProps}
                >
                  {categories.map((cat, index) => (
                    <Draggable draggableId={cat} index={index} key={cat}>
                      {(provided, snapshot) => (
                        <div
                          ref={provided.innerRef}
                          {...provided.draggableProps}
                        >
                          <CategoryItem
                            name={cat}
                            removeFunction={removeCategory}
                            renameFunction={renameCategory}
                            dragHandleProps={provided.dragHandleProps}
                            isDragging={snapshot.isDragging}
                          />
                        </div>
                      )}
                    </Draggable>
                  ))}
                  {provided.placeholder}
                </div>
              )}
            </Droppable>
          </DragDropContext>
        )}
        {categories.length === 0 &&
          t('categories-manager.no-categories', 'No categories yet.')}
        <hr />
        <TextInputField
          htmlId="new-category-name"
          value={newCategoryName}
          onChange={(newValue) => setNewCategoryName(newValue)}
          placeholder={t(
            'categories-manager.add-placeholder',
            'Add new category'
          )}
          afterInput={
            <Button
              size="sm"
              onClick={isBulkMode ? addBulkCategory : addCategory}
              title={t('categories-manager.add', 'Add')}
              disabled={isCategoryNameEmpty}
              icon={<Icon glyph={Plus} size="md" />}
            />
          }
        />
      </ModalContent>
    </Modal>
  )
}

export default CategoriesManager

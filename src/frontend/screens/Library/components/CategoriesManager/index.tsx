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
import { Dialog, DialogHeader } from 'frontend/components/UI/Dialog'
import { DialogContent } from '@mui/material'
import { TextInputField } from 'frontend/components/UI'
import './index.css'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import {
  faAdd,
  faCancel,
  faCheck,
  faGripVertical,
  faPencil,
  faTrash
} from '@fortawesome/free-solid-svg-icons'

interface CategoryItemProps {
  name: string
  removeFunction: (name: string) => void
  renameFunction: (oldName: string, newName: string) => void
  dragHandleProps: DraggableProvidedDragHandleProps | null
  isDragging: boolean
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
        <button
          className="button is-primary"
          onClick={() => rename()}
          title={t(
            'categories-manager.confirm-rename',
            'Confirm rename of "{{oldName}}" as "{{newName}}"',
            { oldName: name, newName }
          )}
          disabled={isNewNameEmptyOrEqualsOldName}
        >
          <FontAwesomeIcon icon={faCheck} />
        </button>
      )
    } else if (removeMode) {
      return (
        <button
          className="button is-danger"
          onClick={() => remove()}
          title={t(
            'categories-manager.confirm-remove',
            'Confirm removal of "{{name}}"',
            { name }
          )}
        >
          <FontAwesomeIcon icon={faCheck} />
        </button>
      )
    } else {
      return (
        <button
          className="button is-danger"
          onClick={() => setRemoveMode(true)}
          title={t('categories-manager.remove', 'Remove "{{name}}"', { name })}
        >
          <FontAwesomeIcon icon={faTrash} />
        </button>
      )
    }
  }

  const rightButton = () => {
    if (renameMode) {
      return (
        <button
          className="button is-secondary"
          onClick={() => cancelEdit()}
          title={t(
            'categories-manager.cancel-rename',
            'Cancel rename of "{{name}}"',
            { name }
          )}
        >
          <FontAwesomeIcon icon={faCancel} />
        </button>
      )
    } else if (removeMode) {
      return (
        <button
          className="button is-secondary"
          onClick={() => setRemoveMode(false)}
          title={t(
            'categories-manager.cancel-remove',
            'Cancel removal of "{{name}}"',
            { name }
          )}
        >
          <FontAwesomeIcon icon={faCancel} />
        </button>
      )
    } else {
      return (
        <button
          className="button is-secondary"
          onClick={() => setRenameMode(true)}
          title={t('categories-manager.rename', 'Rename "{{name}}"', { name })}
        >
          <FontAwesomeIcon icon={faPencil} />
        </button>
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
        <FontAwesomeIcon icon={faGripVertical} />
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

function CategoriesManager() {
  const { t } = useTranslation()
  const { customCategories } = useContext(ContextProvider)

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

  const handleDragEnd = ({ source, destination }: DropResult) => {
    if (!destination || destination.index === source.index) {
      return
    }

    customCategories.setCategoryOrder(
      reorderCategories(categories, source.index, destination.index)
    )
  }

  return (
    <Dialog
      showCloseButton
      onClose={() => setShowCategories(false)}
      className="CategoriesManager__Dialog"
    >
      <DialogHeader onClose={() => setShowCategories(false)}>
        <div>{t('categories-manager.title', 'Manage Categories')}</div>
      </DialogHeader>
      <DialogContent>
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
            <button
              className="button"
              onClick={() => addCategory()}
              title={t('categories-manager.add', 'Add')}
              disabled={isCategoryNameEmpty}
            >
              <FontAwesomeIcon icon={faAdd} />
            </button>
          }
        />
      </DialogContent>
    </Dialog>
  )
}

export default CategoriesManager

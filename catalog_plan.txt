мои записи по алгоритму построения data_since каталога анимаций, составь    правильную независимую многоуровневую схему по моим запискам:
мне нужно разбить данные для ЛЛМ обучения 

независимые, не вложеные: * `category` * `asset_category` * `animation_type` * `skeleton_type` * `content_type`.

зависимые и вложенные:
taxonomy > category > class > type > group > tag/ label.

* `asset_category`:character
humanoid
creature
animal
monster
npc
boss
object
prop
item
collectible
weapon
tool
environment
background
decor
architecture
foliage
vehicle
mech
robot
ui
ux
icon
hud
loader
transition
fx
vfx
particles
magic
weather
cinematic
cutscene
emote
pet
companion
mount

`animation_type`:
character
creature
object
environment
vehicle
ui
fx
cinematic
pet
abstract
typography
logo
weapon
architecture
mechanical
nature
crowd
overlay
transition
loader
icon
background


* `skeleton_type`:
humanoid
quadruped
bird
fish
insect
dragon
snake
spider
creature
monster
robot
mech
mechanical
modular
weapon
gun
sword
vehicle
car
bike
tank
aircraft
spaceship
prop
object
item
chest
door
tree
plant
foliage
ui
icon
hud
cursor
fx
magic
fire
smoke
liquid
electricity
background
environment
architecture
logo
typography
pet
mount
crowd
npc
boss

* `content_type`:
character
creature
object
environment
ui
fx
vehicle
weapon
architecture
typography
logo
cinematic
pet
overlay
abstract
background
icon
transition
loader
crowd
mechanical



tag / label:
style
theme
mood
gameplay_role
rarity
state
action
direction
perspective
animation_state
loop_type
interaction_type
material
element
biome
faction
emotion
age_group
body_type
color_scheme
quality_level
platform
resolution
rig_type
bone_count
physics_type
procedural
modular
runtime_capable
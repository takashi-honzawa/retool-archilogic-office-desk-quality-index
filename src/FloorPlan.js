import React, { useEffect, useRef } from 'react';
import { FloorPlanEngine } from '@archilogic/floor-plan-sdk'
import './FloorPlan.css'

import { getMergedSpace, polygonPerimeter, polygonIntersection } from '@archilogic/scene-structure'

import {
  apiBaseURL,
  startupSettings,
  defaultColors,
  hexToRgb,
  generateGradients2Colors,
  generateGradients3Colors,
  map, 
  arrayEquals,
  objectEquals,
  createLine
} from './utils'

let spaceColorObjects = []
let deskDistanceObjects = []
let deskIndexObjects = []

let midPoints = 10
let minColor = '#df9a9a'
let maxColor = '#21ff00'
let midColor = '#f1ff84'
//const gradientColors = generateGradients2Colors(minColor, maxColor)
const gradientColors = generateGradients3Colors(minColor, midColor, maxColor)

let outMin = 0
let outMax = midPoints - 1

let token
let floorId
let spaceApiData
let hasLoaded = false
let fpe
let layer
let colorScheme
let cursorMarker
let nearestMarkers = []
let bestWorstMarkers = []

let desks
let deskCount
let selectedSpaces
let selectedAssets
let windowsOnPerimeter

let prevClickedAssetId

let prevIndex

let minMaxDistances
let minMaxIndex
const minMaxObject = {
  collaborative: {min: {value: 10, desk: undefined}, max: {value: 0, desk: undefined}}, 
  quiet: {min: {value: 10, desk: undefined}, max: {value: 0, desk: undefined}}
}

const FloorPlan = ({ triggerQuery, model, modelUpdate }) => {
  const container = useRef(null);

  console.log('model', model)
  token = model.token
  floorId = model.floorId

  function addMarker(fpe, position, isCursorMarker, markerType = 'defalut-marker') {
    const el = document.createElement('div');
    el.className =  isCursorMarker ? "cursor-marker" : "icon-marker"
    el.classList.add(markerType)

    const marker = fpe.addHtmlMarker({
      el,
      pos: position,
      offset: [0, 0],
      radius: false,
    });
    return marker;
  }
  function getDistance(p1, p2) {
    let x = p2.x - p1.x;
    let y = p2.y - p1.y;
    return Math.sqrt(x * x + y * y);
  }
  function removeCursorMarker(){
    if (cursorMarker){
      cursorMarker.remove();
      cursorMarker = undefined
    }
  }
  function removeNearestMarkers(){
    if (nearestMarkers.length !== 0){
      nearestMarkers.forEach(marker => marker.remove())
      nearestMarkers = [];
    }
  }
  function removeBestWorstMarkers(){
    if(bestWorstMarkers.length !== 0){
      bestWorstMarkers.forEach(marker => marker.remove())
      bestWorstMarkers = []
    }
  }

  function selectSpacesAssets(resources){
    desks = resources.assets.filter(asset => asset.subCategories.includes("desk"))
    deskCount = desks.length

    const socializeUsages = ["lobby", "reception", "lounge", "cafe", "canteen", "pantry", "common", "hub"]
    const amenityUsages = ["cafe",  "canteen", "pantry", "kitchen", "printStation", "storage", "mailRoom"]
    const circulateUsages = ['corridor', 'foyer', 'staircase', 'elevator']

    const meetingRoom = resources.spaces.filter(space => space.program === "meet")
    const socializeSpace = resources.spaces.filter(space => socializeUsages.includes(space.usage))
    const amenity = resources.spaces.filter(space => amenityUsages.includes(space.usage))
    const circulate = resources.spaces.filter(space => circulateUsages.includes(space.usage))

    const restroom = resources.spaces.filter(space => space.usage === "restroom")
    const storage = resources.spaces.filter(space => space.usage === 'storage')
    const elevator = resources.spaces.filter(space => space.usage === 'elevator')
    const staircase = resources.spaces.filter(space => space.usage === 'staircase')

    // const hub = resources.spaces.filter(space => space.usage === 'hub')
    // const cafe = resources.spaces.filter(space => space.usage === 'cafe')
    // const pantry = resources.spaces.filter(space => space.usage === 'pantry')
    // const lounge = resources.spaces.filter(space => space.usage === 'lounge')

    selectedSpaces = {
      meetingRoom: meetingRoom,
      socializeSpace: socializeSpace,
      amenity: amenity,
      circulate: circulate,

      //only for icons
      restroom: restroom,
      storage: storage,
      elevator: elevator,
      staircase: staircase,

      // hub: hub,
      // cafe: cafe,
      // pantry: pantry,
      // lounge: lounge
    }

    const plant = resources.assets.filter(asset => asset.subCategories.includes('plant'))
    const window = fpe.scene.nodesByType.window.map(node => {
      return node.getWorldPosition()
    })
    
    selectedAssets = {
      plant: plant,
      window: window
    }
  }

  function createSpaceColorObjects(spaceResources) {
    removeCursorMarker()
    removeNearestMarkers()
    
    if(model.colorScheme === "monochrome"){
      createMonochromeColors(spaceResources)
      colorScheme = 'monochrome'
    } else {
      createDefaultColors(spaceResources)
      colorScheme = 'default'
    }
  }
  function createDefaultColors(spaceResources){
    spaceColorObjects = []
    spaceResources.forEach(space => {
      if ( space.program ) {
        const color = defaultColors[space.program]
        const spaceColorObject = {
          space,
          displayData: { value: null, gradientIndex: null, color: color }
        }
        spaceColorObject.space.node.setHighlight({
          fill: color,
          fillOpacity: 0.4
        })
        spaceColorObjects.push(spaceColorObject)
      } else {
        const color = defaultColors['other']
        const spaceColorObject = {
          space,
          displayData: { value: null, gradientIndex: null, color: color }
        }
        spaceColorObject.space.node.setHighlight({
          fill: color,
          fillOpacity: 0.4
        })
        spaceColorObjects.push(spaceColorObject)
      }
    })
  }
  function createMonochromeColors(spaceResources){
    spaceColorObjects = []
    const color = [255, 255, 255]
    spaceResources.forEach(space => {
      const spaceColorObject = {
        space,
        displayData: { value: null, gradientIndex: null, color: color }
      }
      spaceColorObject.space.node.setHighlight({
        fill: color,
        fillOpacity: 0.4
      })
      spaceColorObjects.push(spaceColorObject)
    })
  }
  function setSpaceColorObjectFillOpacity(opacity){
    spaceColorObjects.forEach(spaceColorObject => {
      spaceColorObject.space.node.setHighlight({
        fill: spaceColorObject.displayData.color,
        fillOpacity: opacity
      })
    })
  }
    
  function createDeskDistanceObject(){
    // arrays of shortest distances to all space and asset type from each desk
    const resourcesForIndexCacl = ['meetingRoom', 'socializeSpace', 'amenity', 'circulate', 'plant', 'window']
    const shortestDistancesFromDesks = {}
    resourcesForIndexCacl.forEach(key => shortestDistancesFromDesks[key] = [])

    deskDistanceObjects = []
    //for each desk...
    for (const desk of desks){
      const deskDistanceObject = {desk: desk, distances: {}, closestResources: {}}

      //find distances to spaces of each type
      for (let spaceType in selectedSpaces){
        const spaceDistanceArr = []

        if(selectedSpaces[spaceType].length !== 0){
          selectedSpaces[spaceType].map(space => {
            const distance = getDistance({x: desk.position.x, y: desk.position.z}, {x: space.center[0], y: space.center[1]})
            spaceDistanceArr.push({distance, space})
          })
          spaceDistanceArr.sort((a, b) => a.distance - b.distance)          
          if(resourcesForIndexCacl.includes(spaceType)){
            shortestDistancesFromDesks[spaceType].push(spaceDistanceArr[0].distance)
            deskDistanceObject.distances[spaceType] = spaceDistanceArr[0].distance
          }
          deskDistanceObject.closestResources[spaceType] = spaceDistanceArr[0].space
        } else {
          shortestDistancesFromDesks[spaceType] = []
          deskDistanceObject.distances[spaceType] = undefined
        }
      }

      for (let assetType in selectedAssets){
        const assetDistanceArr = []

        if(selectedAssets[assetType].length !== 0){
          selectedAssets[assetType].map(asset => {
            let distance 
            if(assetType === 'window'){
              distance = getDistance({x: desk.position.x, y: desk.position.z}, {x: asset.x, y: asset.z})
            } else {
              distance = getDistance({x: desk.position.x, y: desk.position.z}, {x: asset.position.x, y: asset.position.z})
            }
            assetDistanceArr.push({distance, asset})
          })
          assetDistanceArr.sort((a, b) => a.distance - b.distance)
          shortestDistancesFromDesks[assetType].push(assetDistanceArr[0].distance)
          deskDistanceObject.distances[assetType] = assetDistanceArr[0].distance
          deskDistanceObject.closestResources[assetType] = assetDistanceArr[0].asset
        } else {
          shortestDistancesFromDesks[assetType] = []
          deskDistanceObject.distances[assetType] = undefined
        }
      }
      deskDistanceObjects.push(deskDistanceObject)
    }

    minMaxDistances = {}
    for (let spaceAssetType in shortestDistancesFromDesks){
      const length = shortestDistancesFromDesks[spaceAssetType].length
      shortestDistancesFromDesks[spaceAssetType].sort((a, b) => a - b)

      minMaxDistances[spaceAssetType] = {
        min: shortestDistancesFromDesks[spaceAssetType][0],
        max: shortestDistancesFromDesks[spaceAssetType][length - 1]
      }
    }
  }

  function calculateIndexForDesks(){
    deskIndexObjects = []

    const indexValueArr = {
      collaborative: [],
      quiet: []
    }

    deskDistanceObjects.forEach(desk => {
      const remappedValues = {}
      for (const metric in desk.distances) {
        
        const remappedFloat = map(desk.distances[metric], minMaxDistances[metric].min, minMaxDistances[metric].max, outMin, outMax)
        const remappedInt = Math.trunc(remappedFloat)//+ 1
        remappedValues[metric] = 10 - remappedInt
      }
      const deskMetricIndexObject = {...desk, metric: {}, index: {}}
      
      deskMetricIndexObject.metric['social'] = remappedValues.socializeSpace
      
      const noiseMetricArr = [remappedValues.socializeSpace, remappedValues.meetingRoom, remappedValues.circulate]
      noiseMetricArr.sort((a, b) => a - b)
      deskMetricIndexObject.metric['noise'] = noiseMetricArr[2]
      const invertedNoise = 10 - deskMetricIndexObject.metric.noise
      deskMetricIndexObject.metric['invertedNoise'] = invertedNoise

      deskMetricIndexObject.metric['amenity'] = remappedValues.amenity
      deskMetricIndexObject.metric['circulate'] = remappedValues.circulate
      deskMetricIndexObject.metric['green'] = remappedValues.plant
      deskMetricIndexObject.metric['naturalLight'] = remappedValues.window

      const collabIndex = calculateIndex(deskMetricIndexObject.metric, 'collaborative')
      const quietIndex = calculateIndex(deskMetricIndexObject.metric, 'quiet')
      
      if(collabIndex < minMaxObject.collaborative.min.value){
        minMaxObject.collaborative.min.value = collabIndex
        minMaxObject.collaborative.min.desk = desk.desk
      } 
      if(collabIndex > minMaxObject.collaborative.max.value){
        minMaxObject.collaborative.max.value = collabIndex
        minMaxObject.collaborative.max.desk = desk.desk
      }

      if(quietIndex < minMaxObject.quiet.min.value){
        minMaxObject.quiet.min.value = quietIndex
        minMaxObject.quiet.min.desk = desk.desk
      } 
      if(quietIndex > minMaxObject.quiet.max.value){
        minMaxObject.quiet.max.value = quietIndex
        minMaxObject.quiet.max.desk = desk.desk
      }

      deskMetricIndexObject.index['collaborative'] = collabIndex
      deskMetricIndexObject.index['quiet'] = quietIndex

      deskIndexObjects.push(deskMetricIndexObject)

      indexValueArr.collaborative.push(collabIndex)
      indexValueArr.quiet.push(quietIndex)
    })

    minMaxIndex = {}
    for (let index in indexValueArr){
      const length = indexValueArr[index].length
      indexValueArr[index].sort((a, b) => a - b)
      minMaxIndex[index] = {
        min: indexValueArr[index][0],
        max: indexValueArr[index][length - 1]
      }
    }
  }
  function calculateIndex(metric, typeOfWork){
    const selectedMetricArr = {
      collaborative: ['social', 'amenity', 'circulate', 'green', 'naturalLight'],
      quiet: ['amenity', 'circulate', 'green', 'naturalLight', 'invertedNoise']
    }
    let sum = 0
    let count = 0
    selectedMetricArr[typeOfWork].forEach(string => {
      if(metric[string]){
        sum = sum + metric[string]
        count = count + 1
      }
    })
    return (sum / count).toFixed(2)
  }
  
  function applyGradients(){
    if(!model.index) return 
    if(prevIndex && prevIndex === model.index) return
  
    prevIndex = model.index

    deskIndexObjects.forEach(desk => {
      const remappedIndex = map(desk.index[model.index], minMaxIndex[model.index].min, minMaxIndex[model.index].max, outMin, outMax)
      const indexValueInt = Math.trunc(remappedIndex)
      const colorValue = gradientColors[indexValueInt]
      const color = hexToRgb(colorValue)
      desk.desk.node.setHighlight({
        fill: color,
        fillOpacity: 1
      })
    })
  }

  function addMarkerToBestWorst(){
    if(!model.index) return 
    
    removeBestWorstMarkers()

    const minDesk = minMaxObject[model.index].min.desk
    const maxDesk = minMaxObject[model.index].max.desk
    
    const worstMarker = addMarker(fpe, [minDesk.position.x, minDesk.position.z], false, 'worst')
    const bestMarer = addMarker(fpe, [maxDesk.position.x, maxDesk.position.z], false, 'best')

    bestWorstMarkers.push(worstMarker)
    bestWorstMarkers.push(bestMarer)
  }

  function onClick(fpe){
    if(!fpe) return
    
    fpe.on('click', (event) => {
      const position = event.pos
      const positionResources = fpe.getResourcesFromPosition(position)
      console.log('positionResources', positionResources)

      if(!positionResources.assets.length){
        removeCursorMarker()
        removeNearestMarkers()
        setSpaceColorObjectFillOpacity(0.4)
        return
      }
      
      const selectedAsset = positionResources.assets[0]

      if(selectedAsset.subCategories[0] !== 'desk') {
        removeCursorMarker()
        removeNearestMarkers()
        setSpaceColorObjectFillOpacity(0.4)
        return
      }

      if (prevClickedAssetId && prevClickedAssetId == selectedAsset.id) return
      prevClickedAssetId = selectedAsset.id
      
      removeCursorMarker()
      removeNearestMarkers()

      cursorMarker = addMarker(fpe, position, true)
      
      const match = deskIndexObjects.find(desk => desk.desk.id === selectedAsset.id)
      console.log('match', match)

      for (let resourceType in match.closestResources){
        const resource = match.closestResources[resourceType]
        if(resourceType === 'amenity' || resourceType === 'circulate' || resourceType === 'window'){
          console.log('no icon available atm')
        } else if(resourceType === 'plant'){
          const marker = addMarker(fpe, [resource.position.x, resource.position.z], false, resourceType)
          nearestMarkers.push(marker)
        } else {
          const marker = addMarker(fpe, [resource.center[0], resource.center[1]], false, resourceType)
          nearestMarkers.push(marker)
        }
      }
      modelUpdate({deskIndex: match.index, deskMetric: match.metric})
    })
  }

  async function init(){
    fpe = new FloorPlanEngine({container: container.current, options: startupSettings})
    await fpe.loadScene(floorId, {publishableAccessToken: token})
    hasLoaded = floorId
    prevIndex = undefined

    //spaceApiData = await fetch(`${apiBaseURL}/space?floorId=${floorId}&pubtoken=${token}&geometry=true`).then(res => res.json())
  }
  
  useEffect(() => {
    if(!token || !floorId) return
    if(fpe && hasLoaded === floorId) return
    if(container.current){
      init()
      .then(() => {
        selectSpacesAssets(fpe.resources)
        createSpaceColorObjects(fpe.resources.spaces)
        createDeskDistanceObject()
        calculateIndexForDesks()
      })
    }
  })

  useEffect(() => {
    if(!fpe) return
    onClick(fpe)
    applyGradients()
    addMarkerToBestWorst()
    if(model.colorScheme === colorScheme) return
    if(!colorScheme) return
    createSpaceColorObjects(fpe.resources.spaces)
  })
  
  return(
    <div className='fpe' id="floor-plan" ref={container}></div>
  )
}

export default FloorPlan